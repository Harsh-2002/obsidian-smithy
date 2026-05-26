import type { App, TFile } from 'obsidian';

import type { AssetRef } from '../types';

/**
 * Rewriter — apply a set of AssetRef → newRaw substitutions to the post's
 * markdown, atomically, using Obsidian's `vault.process()` to avoid the
 * read-then-modify race that loses concurrent edits.
 *
 * Why offset-based: a single post can reference the same image twice with
 * different alt text — naive string `.replace()` would replace both
 * occurrences from the first match. We carry startIdx/endIdx from the
 * walker through the resolver and apply replacements right-to-left so
 * earlier offsets stay valid.
 */

export interface Replacement {
  ref: AssetRef;
  /** New substring to put in place of `ref.raw`. */
  newRaw: string;
}

/**
 * Atomically rewrite `file` by applying every replacement. If two
 * replacements overlap (shouldn't happen with our walker) the later one
 * by startIdx wins.
 */
export async function rewritePost(
  app: App,
  file: TFile,
  replacements: Replacement[],
): Promise<void> {
  if (replacements.length === 0) return;

  // Sort descending by startIdx so applying does not invalidate offsets
  // earlier in the string. (Each replacement.ref carries the offsets in
  // the markdown SOURCE that the walker scanned.)
  const sorted = [...replacements].sort(
    (a, b) => b.ref.startIdx - a.ref.startIdx,
  );

  await app.vault.process(file, (current) => {
    // Re-anchor replacements: if the file has changed since the walker
    // ran (rare but possible if the user typed while uploads were
    // in-flight), `current` may not match the offsets. Fall back to a
    // literal-substring replace for any offset miss.
    let out = current;

    for (const r of sorted) {
      const idx = out.indexOf(r.ref.raw);

      if (idx < 0) {
        // No-op — the ref isn't in the current file. Could mean the user
        // already removed it; we skip rather than mangle the document.
        continue;
      }
      out = out.slice(0, idx) + r.newRaw + out.slice(idx + r.ref.raw.length);
    }

    return out;
  });
}
