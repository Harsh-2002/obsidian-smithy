import type { App, TFile } from 'obsidian';

import { commitFile, GitHubConflictError } from '../git/github-rest';
import { getEngine, slugFromPostPath } from '../engine';
import { getSecret } from '../secrets';
import { publicUrlFor, S3Client } from '../storage/s3-client';
import { renderKey } from '../storage/path-template';
import type {
  CommitResult,
  PluginSettings,
  PublishReport,
  PublishWarning,
  ResolvedAsset,
  UploadResult,
} from '../types';

import { resolveRefs } from './resolve';
import { rewritePost, type Replacement } from './rewrite';
import { validatePost } from './validate';
import { walkMarkdown } from './walker';

/**
 * Orchestrate the full publish pipeline for a single post file.
 *
 *   validate → walk → resolve → upload → rewrite → commit → notify
 *
 * Each phase is a thin wrapper over the module that owns it; this file
 * exists only to sequence them and shape the final PublishReport for the
 * UI to render.
 *
 * Failure semantics:
 *   - validate fails  → throw PipelineError, surface to user
 *   - resolve warnings → propagate to report; pipeline continues
 *   - upload fails     → throw PipelineError, DON'T rewrite or commit
 *   - rewrite fails    → throw (the file should be untouched given
 *                        vault.process semantics)
 *   - commit conflict  → throw GitHubConflictError (UI shows modal)
 *   - commit fails     → throw PipelineError
 *
 * Idempotency:
 *   - resolveRefs skips refs already on the CDN (publicUrlBase prefix)
 *   - commitFile no-ops when the new body equals the current body
 */

const PARALLEL_UPLOADS = 4;

export class PipelineError extends Error {
  constructor(message: string, public readonly phase: PipelinePhase) {
    super(message);
    this.name = 'PipelineError';
  }
}

export type PipelinePhase =
  | 'validate'
  | 'walk'
  | 'resolve'
  | 'upload'
  | 'rewrite'
  | 'commit';

/**
 * Lightweight progress callback for the UI. Each phase ticks once; upload
 * ticks per-asset so a busy post shows incremental progress.
 */
export type ProgressFn = (event: ProgressEvent) => void;

export type ProgressEvent =
  | { type: 'phase'; phase: PipelinePhase; status: 'start' | 'done' }
  | { type: 'upload-progress'; current: number; total: number; filename: string }
  | { type: 'warning'; warning: PublishWarning };

export interface PublishOptions {
  /** Per-phase progress. UI uses this to update the publish modal. */
  onProgress?: ProgressFn;
  /** Resolved secrets (so UI tests can stub). If absent, fetched via secretStorage. */
  resolvedSecrets?: {
    accessKeyId: string;
    secretAccessKey: string;
    githubToken: string;
  };
}

export async function publishPost(
  app: App,
  postFile: TFile,
  settings: PluginSettings,
  opts: PublishOptions = {},
): Promise<PublishReport> {
  const tick = (event: ProgressEvent) => opts.onProgress?.(event);
  const report: PublishReport = {
    postPath: postFile.path,
    uploaded: [],
    warnings: [],
  };

  // ---------- 1. VALIDATE ----------
  tick({ type: 'phase', phase: 'validate', status: 'start' });
  const postSource = await app.vault.read(postFile);
  const validation = await validatePost(postFile, postSource, settings);

  if (!validation.ok) {
    throw new PipelineError(validation.reason, 'validate');
  }
  tick({ type: 'phase', phase: 'validate', status: 'done' });

  // ---------- 2. WALK ----------
  tick({ type: 'phase', phase: 'walk', status: 'start' });
  const refs = walkMarkdown(validation.body);

  tick({ type: 'phase', phase: 'walk', status: 'done' });

  // ---------- 3. RESOLVE ----------
  tick({ type: 'phase', phase: 'resolve', status: 'start' });
  const outcome = resolveRefs(app, postFile, refs, settings);

  for (const w of outcome.warnings) {
    report.warnings.push(w);
    tick({ type: 'warning', warning: w });
  }
  tick({ type: 'phase', phase: 'resolve', status: 'done' });

  // ---------- 4. UPLOAD ----------
  tick({ type: 'phase', phase: 'upload', status: 'start' });

  // Resolve secrets BEFORE constructing the client so credential errors
  // surface as PipelineError with a clear message, not a generic S3 fault.
  const secrets =
    opts.resolvedSecrets ??
    (await resolveAllSecrets(app, settings));

  if (outcome.toUpload.length > 0) {
    if (!secrets.accessKeyId || !secrets.secretAccessKey) {
      throw new PipelineError(
        'S3 credentials are not set — fill in access key + secret in Settings',
        'upload',
      );
    }
  }

  const s3 =
    outcome.toUpload.length > 0
      ? new S3Client(settings.storage, {
          accessKeyId: secrets.accessKeyId,
          secretAccessKey: secrets.secretAccessKey,
        })
      : null;
  const slug = slugFromPostPath(postFile.path, settings.site.postsFolder);
  const replacements: Replacement[] = [];

  if (s3 && outcome.toUpload.length > 0) {
    let uploadedCount = 0;

    // Run uploads in batches of PARALLEL_UPLOADS to keep mobile happy and
    // give the UI a steady progress tick.
    for (let i = 0; i < outcome.toUpload.length; i += PARALLEL_UPLOADS) {
      const batch = outcome.toUpload.slice(i, i + PARALLEL_UPLOADS);

       
      await Promise.all(
        batch.map(async (asset) => {
          const result = await uploadOne(app, s3, asset, slug, settings);

          report.uploaded.push(result);
          replacements.push({
            ref: asset.ref,
            newRaw: makeReplacement(asset, result.url),
          });

          uploadedCount++;
          tick({
            type: 'upload-progress',
            current: uploadedCount,
            total: outcome.toUpload.length,
            filename: asset.file.name,
          });
        }),
      );
    }
  }

  // Add the wiki-link → permalink rewrites (no upload required).
  for (const r of outcome.toRewrite) {
    replacements.push(r);
  }

  tick({ type: 'phase', phase: 'upload', status: 'done' });

  // ---------- 5. REWRITE ----------
  if (replacements.length > 0) {
    tick({ type: 'phase', phase: 'rewrite', status: 'start' });
    try {
      await rewritePost(app, postFile, replacements);
    } catch (e) {
      throw new PipelineError(
        `markdown rewrite failed: ${e instanceof Error ? e.message : String(e)}`,
        'rewrite',
      );
    }
    tick({ type: 'phase', phase: 'rewrite', status: 'done' });
  }

  // ---------- 6. COMMIT ----------
  tick({ type: 'phase', phase: 'commit', status: 'start' });

  if (!secrets.githubToken) {
    throw new PipelineError(
      'GitHub PAT is not set — fill in the token in Settings',
      'commit',
    );
  }

  // Re-read the file post-rewrite so the commit reflects the final state.
  const finalBody = await app.vault.read(postFile);
  const commitMessage = settings.git.commitMessageTemplate
    .replaceAll('{slug}', slug)
    .replaceAll('{title}', String(validation.frontmatter.data.title ?? slug))
    .replaceAll('{date}', new Date().toISOString().slice(0, 10));

  let commit: CommitResult;

  try {
    commit = await commitFile(settings.git, {
      path: postFile.path,
      body: finalBody,
      message: commitMessage,
      token: secrets.githubToken,
    });
  } catch (e) {
    if (e instanceof GitHubConflictError) throw e;
    throw new PipelineError(
      `commit failed: ${e instanceof Error ? e.message : String(e)}`,
      'commit',
    );
  }

  report.commit = commit;
  report.livePostUrl = getEngine(settings.site.engine).permalinkFor(
    postFile.path,
    settings,
  );

  tick({ type: 'phase', phase: 'commit', status: 'done' });

  return report;
}

/* ---------- helpers ---------- */

async function uploadOne(
  app: App,
  s3: S3Client,
  asset: ResolvedAsset,
  slug: string,
  settings: PluginSettings,
): Promise<UploadResult> {
  const bytes = await app.vault.readBinary(asset.file);
  const key = await renderKey(settings.storage.pathTemplate, {
    date: new Date(),
    slug,
    filename: asset.file.name,
    bytes,
  });
  const url = publicUrlFor(settings.storage.publicUrlBase, key);

  // Re-uploading the same key is cheap and atomic on S3; skipping a HEAD
  // round-trip keeps the pipeline simple. Idempotency at the higher level
  // already filters out refs whose target is already on the CDN.
  await s3.putObject(key, bytes, asset.contentType);

  return { ref: asset.ref, key, url, skipped: false };
}

/**
 * Build the new raw substring that will replace the original AssetRef.
 * Preserves the original "kind shape" — image stays image, link stays link.
 */
function makeReplacement(asset: ResolvedAsset, cdnUrl: string): string {
  const alt = asset.ref.alt ?? '';

  switch (asset.ref.kind) {
    case 'image':
      return `![${alt}](${cdnUrl})`;
    case 'link':
      return `[${alt || asset.file.name}](${cdnUrl})`;
    case 'wiki-embed':
      return `![${alt || asset.file.basename}](${cdnUrl})`;
    case 'wiki-link':
      // Should never appear here (wiki-links go through toRewrite, not
      // toUpload), but handle defensively.
      return `[${alt || asset.file.basename}](${cdnUrl})`;
  }
}

async function resolveAllSecrets(app: App, settings: PluginSettings) {
  const [accessKeyId, secretAccessKey, githubToken] = await Promise.all([
    getSecret(app, settings.storage.accessKeyIdSecret),
    getSecret(app, settings.storage.secretAccessKeySecret),
    getSecret(app, settings.git.patSecret),
  ]);

  return {
    accessKeyId: accessKeyId ?? '',
    secretAccessKey: secretAccessKey ?? '',
    githubToken: githubToken ?? '',
  };
}
