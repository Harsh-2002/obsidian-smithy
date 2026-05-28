import type { App, TFile } from 'obsidian';

import { parseFrontmatter } from '../frontmatter/parse';

/**
 * Set or update a single top-level scalar key in the active file's
 * frontmatter, atomically via `vault.process()`.
 *
 *   - Detects TOML (+++) vs YAML (---) delimiters.
 *   - If the key already exists, its value is replaced in place
 *     (preserving the original line position).
 *   - If the key does not exist, it's appended just before the closing
 *     delimiter.
 *   - If the file has no frontmatter, a new block is inserted at the
 *     top in TOML (the firstfinger / Hugo convention).
 *
 * The value is serialized as:
 *   - string  → `"escaped"` (TOML) / `escaped` (YAML)
 *   - boolean → `true` / `false`
 *   - Date    → ISO 8601 ("2026-05-26T12:34:56Z")
 *
 * The function is conservative: it never reformats other fields, never
 * removes anything. Worst case it's a no-op + warning.
 */
export async function setFrontmatterKey(
  app: App,
  file: TFile,
  key: string,
  value: string | boolean | Date,
): Promise<void> {
  await app.vault.process(file, (current) => updateFrontmatter(current, key, value));
}

/* ---------- pure-string helpers (exported for tests) ---------- */

export function updateFrontmatter(
  src: string,
  key: string,
  value: string | boolean | Date,
): string {
  let fm;

  try {
    fm = parseFrontmatter(src);
  } catch {
    // Malformed frontmatter — refuse to mangle the document. The publish
    // pipeline calls this as a best-effort metadata writeback, so silently
    // returning `src` keeps the publish from cascading-failing on a parse
    // bug. The user already saw the parse error during the validate phase.
    return src;
  }

  if (fm.format === 'none') {
    // No frontmatter at all — synthesize a TOML block at the top.
    const block = ['+++', `${key} = ${formatValue('toml', value)}`, '+++', ''].join('\n');

    return block + src;
  }

  // Find the closing delimiter and the inner block boundaries.
  const delim = fm.format === 'toml' ? '+++' : '---';
  const openEnd = delim.length; // src starts with delim
  const closeStart = findClosingDelimiterOffset(src, delim);

  if (closeStart < 0) {
    // Shouldn't happen — parseFrontmatter only returns toml/yaml when
    // both delimiters exist. Be defensive.
    return src;
  }

  const inner = src.slice(openEnd, closeStart);
  const serialized = formatValue(fm.format, value);
  const newLine = `${key} = ${serialized}`;
  const yamlLine = `${key}: ${formatValue('yaml', value)}`;
  const formattedLine = fm.format === 'toml' ? newLine : yamlLine;

  const updatedInner = replaceOrAppend(inner, key, formattedLine, fm.format);
  const before = src.slice(0, openEnd);
  const after = src.slice(closeStart);

  return before + updatedInner + after;
}

function formatValue(
  format: 'toml' | 'yaml',
  value: string | boolean | Date,
): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  // string
  if (format === 'toml') {
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }
  // YAML: quote when a bare scalar would be re-typed (number/bool/null/date),
  // is empty, has edge whitespace, or contains structural characters.
  if (needsYamlQuoting(value)) {
    return `'${value.replaceAll("'", "''")}'`;
  }

  return value;
}

/**
 * True if `v` must be single-quoted to round-trip as a YAML string. Without
 * this, a `cover`/`last_published` value like `12345`, `true`, `yes`, or
 * `2026-05-28` would be parsed back as a number/bool/timestamp, not text.
 */
function needsYamlQuoting(v: string): boolean {
  if (v === '') return true;
  if (/^\s|\s$/.test(v)) return true; // leading/trailing whitespace
  if (/^(true|false|yes|no|on|off|null|~)$/i.test(v)) return true; // bool/null
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return true; // number
  if (/^\d{2,4}[-:]\d/.test(v)) return true; // date / time-ish
  if (/^[!&*?|>@%"'`#,[\]{} -]/.test(v)) return true; // unsafe leading indicator
  if (/:\s|:$|\s#/.test(v)) return true; // ": " mapping / trailing ":" / " #" comment
  if (/[{}[\],&*!|>%@`]/.test(v)) return true; // flow / special characters

  return false;
}

function replaceOrAppend(
  inner: string,
  key: string,
  newLine: string,
  format: 'toml' | 'yaml',
): string {
  const lines = inner.split('\n');
  const keyPattern = format === 'toml'
    ? new RegExp(`^\\s*${escapeReg(key)}\\s*=`)
    : new RegExp(`^\\s*${escapeReg(key)}\\s*:`);

  for (let i = 0; i < lines.length; i++) {
    if (keyPattern.test(lines[i])) {
      lines[i] = newLine;
      return lines.join('\n');
    }
  }

  // Not found — append before any trailing blank lines.
  let insertAt = lines.length;

  while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
    insertAt--;
  }
  lines.splice(insertAt, 0, newLine);

  return lines.join('\n');
}

function findClosingDelimiterOffset(src: string, delim: '+++' | '---'): number {
  let i = delim.length;

  while (i < src.length) {
    const nl = src.indexOf('\n', i);
    const lineEnd = nl < 0 ? src.length : nl;
    const line = src.slice(i, lineEnd).trim();

    if (line === delim) return i;
    if (nl < 0) return -1;
    i = nl + 1;
  }

  return -1;
}

function escapeReg(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}
