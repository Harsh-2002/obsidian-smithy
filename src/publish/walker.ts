import { codeRegions, inCodeRegion } from '../util/code-regions';
import type { AssetRef, AssetRefKind } from '../types';

/**
 * Walk a markdown body and emit every reference to a local file or other
 * note. Emits 4 ref kinds:
 *
 *   ![alt](src)                    → 'image'
 *   [text](src)                    → 'link'
 *   ![[file]] or ![[file|alias]]   → 'wiki-embed'
 *   [[file]]  or [[file|alias]]    → 'wiki-link'
 *
 * Skip rules — these references are NOT emitted because there's nothing
 * to upload/rewrite:
 *
 *   - target starts with http://, https://, ftp://, mailto:, tel:, data:
 *   - target starts with `#` (in-page anchor)
 *   - target starts with `/` (absolute site path — already public)
 *
 * Mobile compat: no regex lookbehind anywhere (iOS < 16.4 lacks support).
 * The image vs link disambiguation is done by character class on the
 * preceding character at scan time, not via `(?<!!)`.
 *
 * Offsets preserved (startIdx/endIdx) so the rewriter can do offset-based
 * substitution and avoid double-replacing identical targets.
 */

/* ---------- regex constants ---------- */

// Standard image / link: `[label](src)` — captures label + src. The `!`
// prefix for images is checked at scan time, not in the regex (no
// lookbehind).
const STD_REF = /\[([^\]\n]*?)\]\(([^)\n]+)\)/g;

// Wiki: `[[target]]` or `[[target|alias]]`. Embed vs link disambiguated by
// preceding `!` at scan time.
const WIKI_REF = /\[\[([^\]\n]+?)\]\]/g;

/* ---------- public API ---------- */

export function walkMarkdown(body: string): AssetRef[] {
  const refs: AssetRef[] = [];

  collectStdRefs(body, refs);
  collectWikiRefs(body, refs);

  // Drop refs that live inside a fenced/inline code region — those are
  // examples, not real attachments, and must not be uploaded or rewritten.
  const regions = codeRegions(body);
  const filtered = refs.filter((r) => !inCodeRegion(r.startIdx, regions));

  // Sort by startIdx so downstream consumers (rewriter, progress UI) see
  // refs in the order they appear in the document.
  filtered.sort((a, b) => a.startIdx - b.startIdx);

  return filtered;
}

/* ---------- internal collectors ---------- */

function collectStdRefs(body: string, into: AssetRef[]): void {
  for (const m of body.matchAll(STD_REF)) {
    if (m.index === undefined) continue;
    const fullMatch = m[0];
    const label = m[1] ?? '';
    const target = m[2] ?? '';
    const startIdx = m.index;
    const endIdx = startIdx + fullMatch.length;

    if (shouldSkip(target)) continue;

    // Is this an image? Check the preceding char without a lookbehind.
    const isImage = startIdx > 0 && body.charAt(startIdx - 1) === '!';
    // For images, the AssetRef's raw substring includes the leading `!`
    // so the rewriter can swap it cleanly.
    const adjustedStart = isImage ? startIdx - 1 : startIdx;
    const raw = isImage ? `!${fullMatch}` : fullMatch;
    const kind: AssetRefKind = isImage ? 'image' : 'link';

    into.push({
      kind,
      raw,
      target: target.trim(),
      alt: label || undefined,
      startIdx: adjustedStart,
      endIdx,
    });
  }
}

function collectWikiRefs(body: string, into: AssetRef[]): void {
  for (const m of body.matchAll(WIKI_REF)) {
    if (m.index === undefined) continue;
    const inner = m[1] ?? '';
    const startIdx = m.index;
    const endIdx = startIdx + m[0].length;

    // target | alias split (Obsidian convention)
    const pipe = inner.indexOf('|');
    const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
    const alt = pipe < 0 ? undefined : inner.slice(pipe + 1).trim();

    if (shouldSkip(target)) continue;

    const isEmbed = startIdx > 0 && body.charAt(startIdx - 1) === '!';
    const adjustedStart = isEmbed ? startIdx - 1 : startIdx;
    const raw = isEmbed ? `!${m[0]}` : m[0];
    const kind: AssetRefKind = isEmbed ? 'wiki-embed' : 'wiki-link';

    into.push({
      kind,
      raw,
      target,
      alt,
      startIdx: adjustedStart,
      endIdx,
    });
  }
}

function shouldSkip(target: string): boolean {
  const t = target.trim();

  if (!t) return true;
  if (
    t.startsWith('http://') ||
    t.startsWith('https://') ||
    t.startsWith('ftp://') ||
    t.startsWith('mailto:') ||
    t.startsWith('tel:') ||
    t.startsWith('data:')
  ) {
    return true;
  }
  if (t.startsWith('#')) return true;
  if (t.startsWith('/')) return true;

  return false;
}
