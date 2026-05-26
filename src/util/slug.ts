/**
 * Title → URL-safe slug.
 *
 *   "Fixing xterm-ghostty on macOS!"  →  "fixing-xterm-ghostty-on-macos"
 *
 * Used by "New post" to derive the folder name. Stable and dependency-free.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    // strip combining marks (accents)
    .replace(/[̀-ͯ]/g, '')
    // anything not [a-z0-9-_] → dash
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
}
