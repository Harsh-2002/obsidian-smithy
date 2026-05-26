import { TFile } from 'obsidian';
import type { App } from 'obsidian';

import {
  commitFile,
  getContentSha,
  GitHubConflictError,
} from '../git/github-rest';
import { getEngine, slugFromPostPath } from '../engine';
import { getSecret } from '../secrets';
import { publicUrlFor, S3Client } from '../storage/s3-client';
import { renderKey } from '../storage/path-template';
import { setFrontmatterKey } from '../util/frontmatter-update';
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
  /**
   * Plan-only mode. Walks the markdown + resolves refs + reports what
   * WOULD upload + what WOULD commit, but performs NO side effects
   * (no S3 PUTs, no vault rewrite, no git commit, no last_published
   * stamp).
   */
  dryRun?: boolean;
  /**
   * Callback invoked after a successful commit, carrying the data needed
   * to undo this publish later. The plugin shell saves this into its
   * publishHistory map.
   */
  onCommitted?: (entry: {
    publishedAt: string;
    commitSha: string;
    commitUrl: string;
    previousFileSha?: string;
    previousBody?: string;
  }) => Promise<void> | void;
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

  // Additionally: look at known frontmatter image fields (cover, image,
  // banner, og_image, thumbnail, featured_image) for LOCAL refs. The user
  // shouldn't have to upload separately + paste a URL into frontmatter —
  // they should just type a filename next to index.md and have publish
  // do the rest.
  const fmImageRefs = collectFrontmatterImageAssets(
    app,
    postFile,
    validation.frontmatter.data as Record<string, unknown>,
    settings,
  );

  for (const w of outcome.warnings) {
    report.warnings.push(w);
    tick({ type: 'warning', warning: w });
  }
  tick({ type: 'phase', phase: 'resolve', status: 'done' });

  // ---------- 4. UPLOAD ----------
  tick({ type: 'phase', phase: 'upload', status: 'start' });

  // Resolve secrets BEFORE constructing the client so credential errors
  // surface as PipelineError with a clear message, not a generic S3 fault.
  // Dry-run skips secret resolution entirely.
  const secrets = opts.dryRun
    ? { accessKeyId: '', secretAccessKey: '', githubToken: '' }
    : opts.resolvedSecrets ?? (await resolveAllSecrets(app, settings));

  if (!opts.dryRun && outcome.toUpload.length > 0) {
    if (!secrets.accessKeyId || !secrets.secretAccessKey) {
      throw new PipelineError(
        'S3 credentials are not set — fill in access key + secret in Settings',
        'upload',
      );
    }
  }

  const totalAssetsToUpload = outcome.toUpload.length + fmImageRefs.length;
  const s3 =
    !opts.dryRun && totalAssetsToUpload > 0
      ? new S3Client(settings.storage, {
          accessKeyId: secrets.accessKeyId,
          secretAccessKey: secrets.secretAccessKey,
        })
      : null;
  const slug = slugFromPostPath(postFile.path, settings.site.postsFolder);
  const replacements: Replacement[] = [];

  /** Frontmatter URL writes queued after upload; keyed by field name. */
  const frontmatterWrites: Array<{ field: string; url: string }> = [];

  if (totalAssetsToUpload > 0) {
    let uploadedCount = 0;

    // Body refs first.
    for (let i = 0; i < outcome.toUpload.length; i += PARALLEL_UPLOADS) {
      const batch = outcome.toUpload.slice(i, i + PARALLEL_UPLOADS);

      await Promise.all(
        batch.map(async (asset) => {
          const result = opts.dryRun
            ? await planOne(app, asset, slug, settings)
            : await uploadOne(app, s3 as S3Client, asset, slug, settings);

          report.uploaded.push(result);
          replacements.push({
            ref: asset.ref,
            newRaw: makeReplacement(asset, result.url),
          });

          uploadedCount++;
          tick({
            type: 'upload-progress',
            current: uploadedCount,
            total: totalAssetsToUpload,
            filename: asset.file.name,
          });
        }),
      );
    }

    // Frontmatter image refs — same upload mechanics, different rewrite
    // target (the frontmatter field, not the body).
    for (const fmRef of fmImageRefs) {
      const fakeAsset = {
        ref: {
          kind: 'image' as const,
          raw: '',
          target: fmRef.relPath,
          startIdx: -1,
          endIdx: -1,
        },
        file: fmRef.file,
        contentType: 'application/octet-stream',
      };

      const result = opts.dryRun
        ? await planOne(app, fakeAsset, slug, settings)
        : await uploadOne(app, s3 as S3Client, fakeAsset, slug, settings);

      report.uploaded.push(result);
      frontmatterWrites.push({ field: fmRef.field, url: result.url });
      uploadedCount++;
      tick({
        type: 'upload-progress',
        current: uploadedCount,
        total: totalAssetsToUpload,
        filename: fmRef.file.name,
      });
    }
  }

  // Add the wiki-link → permalink rewrites (no upload required).
  for (const r of outcome.toRewrite) {
    replacements.push(r);
  }

  tick({ type: 'phase', phase: 'upload', status: 'done' });

  // ---------- 5. REWRITE (skip in dry-run) ----------
  if ((replacements.length > 0 || frontmatterWrites.length > 0) && !opts.dryRun) {
    tick({ type: 'phase', phase: 'rewrite', status: 'start' });
    try {
      // Frontmatter writes first — each one is its own vault.process call
      // (small, atomic). Then body rewrite handles all the inline refs.
      for (const fw of frontmatterWrites) {
        await setFrontmatterKey(app, postFile, fw.field, fw.url);
      }

      if (replacements.length > 0) {
        await rewritePost(app, postFile, replacements);
      }
    } catch (e) {
      throw new PipelineError(
        `markdown rewrite failed: ${e instanceof Error ? e.message : String(e)}`,
        'rewrite',
      );
    }
    tick({ type: 'phase', phase: 'rewrite', status: 'done' });
  }

  // ---------- 6. COMMIT (skip in dry-run) ----------
  if (opts.dryRun) {
    report.dryRun = true;
    report.livePostUrl = getEngine(settings.site.engine).permalinkFor(
      postFile.path,
      settings,
    );

    return report;
  }

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

  // Snapshot the prior file state BEFORE commit so "Undo last publish"
  // can revert to it. ~50ms duplicate of commitFile's internal lookup —
  // acceptable for the value of having an undo trail.
  let previousFileSha: string | undefined;
  let previousBody: string | undefined;

  try {
    const prior = await getContentSha(settings.git, postFile.path, secrets.githubToken);

    previousFileSha = prior?.sha;
    previousBody = prior?.content;
  } catch {
    // If the prior-state lookup fails we still commit; undo just won't be
    // available for this publish.
  }

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

  // Hand the undo data to the caller (plugin shell saves it to settings).
  if (opts.onCommitted) {
    await opts.onCommitted({
      publishedAt: new Date().toISOString(),
      commitSha: commit.sha,
      commitUrl: commit.commitUrl,
      previousFileSha,
      previousBody,
    });
  }

  // Best-effort: write `last_published` back to the post's frontmatter so
  // the status bar can show a freshness indicator on next open. Done AFTER
  // the commit succeeds so a stamp doesn't get left behind from a partial
  // pipeline. Failures here don't fail the publish — the source of truth
  // is the git commit, not the local stamp.
  try {
    await setFrontmatterKey(app, postFile, 'last_published', new Date());
  } catch (e) {
     
    console.warn('[forge] could not write last_published stamp:', e);
  }

  tick({ type: 'phase', phase: 'commit', status: 'done' });

  return report;
}

/* ---------- helpers ---------- */

/**
 * Known frontmatter keys that typically carry an image reference. We scan
 * these for local file paths; anything that's already an http(s) URL or
 * site-absolute (/foo) gets left alone.
 *
 * Hugo themes differ; this is the union of the common conventions.
 */
const FRONTMATTER_IMAGE_FIELDS = [
  'cover',
  'image',
  'banner',
  'og_image',
  'thumbnail',
  'featured_image',
];

interface FrontmatterImageRef {
  field: string;
  relPath: string;
  file: TFile;
}

/**
 * Look at known cover-like frontmatter fields. For each that holds a
 * non-empty LOCAL path, resolve to a TFile (relative to the post's
 * folder). Returns the resolvable ones; missing files are silently
 * skipped — the publish modal's warning surface is for body refs.
 */
function collectFrontmatterImageAssets(
  app: App,
  postFile: TFile,
  fm: Record<string, unknown>,
  _settings: PluginSettings,
): FrontmatterImageRef[] {
  const out: FrontmatterImageRef[] = [];
  const postDir = postFile.parent?.path ?? '';

  for (const field of FRONTMATTER_IMAGE_FIELDS) {
    const v = fm[field];

    if (typeof v !== 'string' || !v.trim()) continue;
    const target = v.trim();

    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('//') ||
      target.startsWith('/') ||
      target.startsWith('data:')
    ) {
      continue;
    }

    // Resolve relative to the post's parent folder.
    const rel = target.replace(/^\.\//, '');
    const fullPath = postDir ? `${postDir}/${rel}` : rel;
    const candidate = app.vault.getAbstractFileByPath(fullPath);

    if (candidate instanceof TFile) {
      out.push({ field, relPath: target, file: candidate });
    }
  }

  return out;
}

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
 * Dry-run variant of uploadOne — computes the key + URL that WOULD be
 * used, reads the bytes (to feed {hash} templating), but does NOT issue
 * the PUT. The returned UploadResult is flagged `skipped: true` so the
 * UI can distinguish planned-vs-actual uploads.
 */
async function planOne(
  app: App,
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

  return { ref: asset.ref, key, url, skipped: true };
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
