import { sha256Hex } from '../util/hash';

/**
 * Path template engine for S3 object keys.
 *
 * Supported tokens (all optional):
 *
 *   {year}     — 4-digit year of the post's date (or upload time)
 *   {month}    — 2-digit month, zero-padded
 *   {day}      — 2-digit day-of-month, zero-padded
 *   {slug}     — the post folder name (without the leading path)
 *   {filename} — slugified attachment filename WITH extension
 *   {ext}      — file extension WITHOUT the leading dot
 *   {hash}     — first 8 hex chars of SHA-256 over the file bytes
 *
 * Anything not matching `{token}` is left untouched (so users can put
 * literal subfolders in the template).
 */

export interface TemplateContext {
  date: Date;
  slug: string;
  filename: string;
  bytes: ArrayBuffer;
}

/**
 * Render the template, returning the final object key. Async because
 * {hash} needs to crypto.subtle.digest() the bytes.
 */
export async function renderKey(
  template: string,
  ctx: TemplateContext,
): Promise<string> {
  const yyyy = String(ctx.date.getFullYear());
  const mm = String(ctx.date.getMonth() + 1).padStart(2, '0');
  const dd = String(ctx.date.getDate()).padStart(2, '0');

  const slugFile = slugifyFilename(ctx.filename);
  const ext = extOf(slugFile);

  const needsHash = template.includes('{hash}');
  const hash = needsHash ? (await sha256Hex(ctx.bytes)).slice(0, 8) : '';

  return template
    .replaceAll('{year}', yyyy)
    .replaceAll('{month}', mm)
    .replaceAll('{day}', dd)
    .replaceAll('{slug}', sanitizeSlug(ctx.slug))
    .replaceAll('{filename}', slugFile)
    .replaceAll('{ext}', ext)
    .replaceAll('{hash}', hash);
}

/**
 * Lowercase + ASCII-fold a filename, replacing whitespace and unsafe chars
 * with dashes. Preserves a single trailing `.ext`.
 *
 * Why slugify the *key* itself: S3 keys with spaces/unicode/parentheses
 * work technically, but every consumer has to URL-encode them on the way
 * out. Slugifying at upload time means the CDN URL is clean and copyable.
 */
export function slugifyFilename(name: string): string {
  if (!name) return name;
  const lastDot = name.lastIndexOf('.');
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot + 1) : '';

  const slug = slugifyPiece(base);
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '');

  return cleanExt ? `${slug}.${cleanExt}` : slug;
}

/**
 * Sanitize a slug — used for {slug} substitution. The slug is the post's
 * folder name and should ALREADY be well-formed, but we re-slugify it
 * defensively so a misnamed folder can't break the key.
 */
function sanitizeSlug(slug: string): string {
  return slugifyPiece(slug) || 'post';
}

function slugifyPiece(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    // strip combining marks (accents)
    .replace(/[̀-ͯ]/g, '')
    // collapse anything not [a-z0-9-_.] to dashes
    .replace(/[^a-z0-9\-_.]+/g, '-')
    // collapse runs of dashes
    .replace(/-+/g, '-')
    // trim leading/trailing dashes
    .replace(/^-+|-+$/g, '');
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');

  return dot >= 0 ? filename.slice(dot + 1) : '';
}
