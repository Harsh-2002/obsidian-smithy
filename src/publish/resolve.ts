import type { App, TFile } from 'obsidian';
import { TFile as TFileCls } from 'obsidian';

import { getEngine } from '../engine';
import { mimeFromFilename } from '../util/mime';
import { slugify } from '../util/slug';
import type {
  AssetRef,
  PluginSettings,
  PublishWarning,
  ResolvedAsset,
} from '../types';

/**
 * Resolve every AssetRef in a post to either:
 *
 *   - a resolved attachment (will be uploaded and replaced with a CDN URL), OR
 *   - a wiki-link to another post (NOT uploaded; rewritten to Hugo permalink), OR
 *   - a warning if the target can't be found.
 *
 * Per the approved plan: missing refs surface as warnings in the publish
 * modal, NOT as hard failures. The user can fix and re-run.
 */

export interface ResolveOutcome {
  /** Attachments that need to be uploaded to S3. */
  toUpload: ResolvedAsset[];
  /** Wiki-link refs that just need a markdown rewrite (no upload). */
  toRewrite: Array<{ ref: AssetRef; newRaw: string }>;
  warnings: PublishWarning[];
}

export function resolveRefs(
  app: App,
  postFile: TFile,
  refs: AssetRef[],
  settings: PluginSettings,
): ResolveOutcome {
  const engine = getEngine(settings.site.engine);
  const out: ResolveOutcome = { toUpload: [], toRewrite: [], warnings: [] };

  const publicBase = settings.storage.publicUrlBase.replace(/\/+$/, '');

  for (const ref of refs) {
    // Skip if already on the CDN (idempotency).
    if (publicBase && ref.target.startsWith(publicBase + '/')) continue;

    const isWikiLinkToOtherNote = ref.kind === 'wiki-link';

    if (isWikiLinkToOtherNote) {
      const { path, heading, block } = splitLinkTarget(ref.target);
      const target = resolveWikiTarget(app, path, postFile.path);

      if (!target) {
        out.warnings.push({
          kind: 'unresolved-link',
          message: `wiki-link target not found: [[${ref.target}]]`,
          ref,
        });
        continue;
      }
      // Rewrite [[other]] → [alt | post title | basename](permalink)
      const permalink = engine.permalinkFor(target.path, settings);

      if (!permalink) {
        out.warnings.push({
          kind: 'unresolved-link',
          message: `cannot build permalink for "${target.path}"`,
          ref,
        });
        continue;
      }

      // Block refs (#^id) have no Hugo equivalent — keep the link, drop
      // the anchor, and tell the user. Heading refs map to Hugo's
      // slugified heading anchors.
      let finalUrl = permalink;

      if (block) {
        out.warnings.push({
          kind: 'dropped-anchor',
          message: `block reference [[${ref.target}]] has no Hugo equivalent — linking to the post without the anchor`,
          ref,
        });
      } else if (heading) {
        finalUrl = headingAnchor(permalink, heading);
      }

      // Prefer the wiki alias > linked post's frontmatter title > basename.
      // Obsidian's metadataCache keeps parsed frontmatter for every md file
      // in the vault, so this is a sync read with no IO.
      const linkedTitle = readFrontmatterTitle(app, target);
      const text = ref.alt ?? linkedTitle ?? target.basename;

      out.toRewrite.push({ ref, newRaw: `[${text}](${finalUrl})` });
      continue;
    }

    // Otherwise this is an attachment ref (image / link to local file /
    // wiki-embed). Resolve to a TFile.
    const file = resolveAttachmentTarget(app, ref, postFile);

    if (!file) {
      out.warnings.push({
        kind: ref.kind === 'wiki-embed' ? 'unresolved-embed' : 'unresolved-link',
        message: `attachment not found: ${ref.target}`,
        ref,
      });
      continue;
    }

    // A wiki-embed of another NOTE (![[some-note]]) is a transclusion, not
    // an attachment. Uploading the .md to object storage would be wrong, so
    // skip it with a clear warning. (Full transclusion = future work.)
    if (ref.kind === 'wiki-embed' && file.extension === 'md') {
      out.warnings.push({
        kind: 'unsupported-embed',
        message: `note transclusion ![[${ref.target}]] isn't supported yet — embed an image/file or inline the text`,
        ref,
      });
      continue;
    }

    out.toUpload.push({
      ref,
      file,
      contentType: mimeFromFilename(file.name),
    });
  }

  return out;
}

/**
 * Resolve a wiki target ([[name]] or [[name|alias]]) to a TFile via
 * Obsidian's metadataCache. Accepts targets with or without `.md`.
 * Returns null if no match.
 */
function resolveWikiTarget(
  app: App,
  rawTarget: string,
  sourcePath: string,
): TFile | null {
  // metadataCache.getFirstLinkpathDest accepts links with or without `.md`
  // and resolves relative to the source file. Strip any `|alias` and `#anchor`
  // first — getFirstLinkpathDest expects just the link path.
  const { path } = splitLinkTarget(rawTarget);
  const dest = app.metadataCache.getFirstLinkpathDest(path, sourcePath);

  return dest ?? null;
}

/**
 * Split a wiki target into its path and optional fragment.
 *
 *   "note"              → { path: "note" }
 *   "note#Section"      → { path: "note", heading: "Section" }
 *   "note#^block-id"    → { path: "note", block: "block-id" }
 *   "note|alias"        → { path: "note" }   (alias stripped defensively)
 *
 * Pure + exported for unit tests.
 */
export function splitLinkTarget(raw: string): {
  path: string;
  heading?: string;
  block?: string;
} {
  const noAlias = raw.split('|')[0].trim();
  const hashIdx = noAlias.indexOf('#');

  if (hashIdx < 0) return { path: noAlias };

  const path = noAlias.slice(0, hashIdx).trim();
  const frag = noAlias.slice(hashIdx + 1).trim();

  if (frag.startsWith('^')) return { path, block: frag.slice(1).trim() };

  return { path, heading: frag };
}

/**
 * Append a Hugo heading anchor to a permalink. Hugo slugifies heading text
 * (lowercase, hyphenated); `slugify` is a close-enough approximation for
 * the common case. Pure + exported for unit tests.
 */
export function headingAnchor(permalink: string, heading: string): string {
  if (!heading.trim()) return permalink;
  const anchor = slugify(heading);

  return anchor ? `${permalink}#${anchor}` : permalink;
}

/**
 * Resolve an attachment-style ref to a TFile.
 *
 * - For 'image' / 'link': interpret as path relative to the post file's
 *   parent folder. (Hugo page-bundle convention.)
 * - For 'wiki-embed': interpret as a wiki target via metadataCache.
 */
function resolveAttachmentTarget(
  app: App,
  ref: AssetRef,
  postFile: TFile,
): TFile | null {
  if (ref.kind === 'wiki-embed') {
    return resolveWikiTarget(app, ref.target, postFile.path);
  }

  // Standard markdown relative path.
  const postDir = postFile.parent?.path ?? '';
  // Normalize: strip a leading "./" and resolve any "../"
  const target = ref.target.replace(/^\.\//, '');
  const fullPath = joinVaultPath(postDir, target);
  const candidate = app.vault.getAbstractFileByPath(fullPath);

  if (candidate instanceof TFileCls) return candidate;

  return null;
}

/**
 * Read the `title` field from a markdown file's frontmatter via Obsidian's
 * metadataCache (sync, no IO — the cache is kept current by Obsidian).
 * Returns trimmed string if present and non-empty; otherwise null.
 *
 * Used by the wiki-link rewriter to produce nice link text like
 * `[Fixing xterm-ghostty over SSH](/posts/fixing-xterm-ghostty/)` instead
 * of just the slug.
 */
function readFrontmatterTitle(app: App, file: TFile): string | null {
  const cache = app.metadataCache.getFileCache(file);
  const title = cache?.frontmatter?.title;

  if (typeof title !== 'string') return null;
  const trimmed = title.trim();

  return trimmed || null;
}

/**
 * Tiny vault-path joiner. Handles `..` segments. Vault paths always use
 * forward slashes regardless of OS, per Obsidian's API.
 */
function joinVaultPath(base: string, rel: string): string {
  const parts = (base ? base.split('/') : []).concat(rel.split('/'));
  const out: string[] = [];

  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') {
      out.pop();
      continue;
    }
    out.push(p);
  }

  return out.join('/');
}
