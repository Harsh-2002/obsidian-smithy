import { parseYaml } from 'obsidian';

import { parseTomlFrontmatter, type TomlValue } from './toml';

/**
 * Detect, extract, and parse the frontmatter of a markdown file.
 *
 * Hugo supports three delimiters:
 *   `+++ ... +++`     TOML  (default for posts in this repo)
 *   `--- ... ---`     YAML
 *   `--- ... ---json` JSON  (rare; not supported by v1)
 *
 * Returns the parsed object plus the body that follows the closing
 * delimiter. If the file lacks frontmatter altogether, returns
 * `{ data: {}, body: <whole file> }` — that's a no-frontmatter post,
 * which the publish validator will reject with a friendly error.
 */

export type FrontmatterValue = TomlValue | string | number | boolean | null | string[];

export interface ParsedFrontmatter {
  format: 'toml' | 'yaml' | 'none';
  data: Record<string, FrontmatterValue>;
  /** Body text starting after the closing delimiter (no leading newline). */
  body: string;
  /** Char-offset in source where `body` starts — useful for offset-based rewrites. */
  bodyOffset: number;
}

export class FrontmatterError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'FrontmatterError';
  }
}

/**
 * Parse the frontmatter of a markdown source string.
 */
export function parseFrontmatter(src: string): ParsedFrontmatter {
  // TOML: +++ on line 1, closing +++ later
  if (src.startsWith('+++')) {
    return parseDelimited(src, '+++', 'toml');
  }
  // YAML: --- on line 1, closing --- later (NOT followed by `json`)
  if (src.startsWith('---')) {
    // Distinguish `---` (YAML) from a horizontal rule `---` mid-document by
    // requiring a closing `---` somewhere below.
    const closing = findClosingDelimiter(src, '---');

    if (closing >= 0) {
      return parseDelimited(src, '---', 'yaml');
    }
  }

  return { format: 'none', data: {}, body: src, bodyOffset: 0 };
}

function parseDelimited(
  src: string,
  delim: '+++' | '---',
  format: 'toml' | 'yaml',
): ParsedFrontmatter {
  const close = findClosingDelimiter(src, delim);

  if (close < 0) {
    throw new FrontmatterError(
      `frontmatter opens with ${delim} but never closes`,
    );
  }

  const inner = src.slice(delim.length, close);
  const afterCloseStart = close + delim.length;
  // Skip the newline after the closing delimiter, if any
  const bodyStart =
    src.charAt(afterCloseStart) === '\n'
      ? afterCloseStart + 1
      : src.charAt(afterCloseStart) === '\r' && src.charAt(afterCloseStart + 1) === '\n'
        ? afterCloseStart + 2
        : afterCloseStart;
  const body = src.slice(bodyStart);

  let data: Record<string, FrontmatterValue>;

  try {
    if (format === 'toml') {
      data = parseTomlFrontmatter(inner) as Record<string, FrontmatterValue>;
    } else {
      const parsed = parseYaml(inner);

      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new FrontmatterError(
          'YAML frontmatter must be a mapping (key: value pairs)',
        );
      }
      data = parsed as Record<string, FrontmatterValue>;
    }
  } catch (cause) {
    if (cause instanceof FrontmatterError) throw cause;
    throw new FrontmatterError(
      `failed to parse ${format.toUpperCase()} frontmatter: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    );
  }

  return { format, data, body, bodyOffset: bodyStart };
}

/**
 * Find the offset of the *closing* delimiter — the next occurrence after
 * the opening one, on its own line. Returns -1 if no closing delimiter
 * exists.
 */
function findClosingDelimiter(src: string, delim: '+++' | '---'): number {
  // Skip the opening delimiter (which we know matches src.startsWith(delim))
  // and search for `\n{delim}` or `\r\n{delim}` followed by EOF or newline.
  let i = delim.length;

  while (i < src.length) {
    const nl = src.indexOf('\n', i);
    const lineEnd = nl < 0 ? src.length : nl;
    const lineStart = i === delim.length ? i : i;
    const line = src.slice(lineStart, lineEnd).trim();

    if (line === delim) {
      return lineStart;
    }
    if (nl < 0) return -1;
    i = nl + 1;
  }

  return -1;
}
