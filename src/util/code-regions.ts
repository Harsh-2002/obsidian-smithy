/**
 * Code-region detection — find the byte ranges of a markdown body that are
 * "code" and therefore must not be touched by ref-rewriting or
 * Obsidian→Hugo syntax conversion.
 *
 * Two kinds are detected:
 *
 *   - **Fenced code blocks** — a line that is only a ``` (3+ backticks) or
 *     ~~~ (3+ tildes) fence, optionally indented up to 3 spaces, with an
 *     optional info string. Closes on a later line that is a fence of the
 *     same char and at least the same length. An unterminated fence runs
 *     to end-of-document (CommonMark behaviour).
 *   - **Inline code spans** — a run of N backticks closed by the next run
 *     of exactly N backticks on the SAME line. (Line-scoped: multi-line
 *     inline spans are rare and treating them as literal is the safe
 *     failure mode.)
 *
 * A fence marker only counts when the fence is at the line start (after ≤3
 * spaces). A blockquote-prefixed fence like `> ```` is intentionally NOT
 * matched — that keeps callout bodies (which may contain fences) inside a
 * single text segment for the transform pass.
 *
 * Mobile compat: no regex lookbehind (iOS < 16.4 lacks support).
 */

/** A half-open `[start, end)` range, in source char offsets. */
export type Region = [number, number];

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

export function codeRegions(body: string): Region[] {
  const regions: Region[] = [];
  let offset = 0;
  let i = 0;

  const lines = splitKeepingOffsets(body);

  while (i < lines.length) {
    const { text, start } = lines[i];
    const open = FENCE_OPEN.exec(text);

    // A valid backtick fence's info string must not contain backticks.
    const isFence =
      open !== null &&
      (open[1][0] !== '`' || !text.slice(open[1].length).includes('`'));

    if (isFence) {
      const marker = open[1];
      const fenceChar = marker[0];
      const fenceLen = marker.length;
      const closeRe = new RegExp(`^ {0,3}${escapeChar(fenceChar)}{${fenceLen},}\\s*$`);

      let j = i + 1;
      let end = body.length; // unterminated → to EOF

      while (j < lines.length) {
        if (closeRe.test(lines[j].text)) {
          end = lines[j].start + lines[j].text.length;
          break;
        }
        j++;
      }
      regions.push([start, end]);
      i = j + 1;
      offset = end;
      continue;
    }

    // Not a fence line — scan it for inline code spans.
    inlineSpans(text, start, regions);
    i++;
    offset = start + text.length;
  }

  void offset;

  return regions;
}

/** True if `pos` falls inside any code region. */
export function inCodeRegion(pos: number, regions: Region[]): boolean {
  for (const [s, e] of regions) {
    if (pos >= s && pos < e) return true;
  }

  return false;
}

/**
 * Split a body into alternating non-code / code segments so a transform can
 * map over the non-code parts and leave code byte-for-byte intact.
 */
export interface Segment {
  text: string;
  code: boolean;
}

export function splitProtected(body: string): Segment[] {
  const regions = [...codeRegions(body)].sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const [s, e] of regions) {
    if (s < cursor) continue; // overlap guard (shouldn't happen)
    if (s > cursor) segments.push({ text: body.slice(cursor, s), code: false });
    segments.push({ text: body.slice(s, e), code: true });
    cursor = e;
  }
  if (cursor < body.length) {
    segments.push({ text: body.slice(cursor), code: false });
  }

  return segments;
}

/* ---------- internals ---------- */

interface LineInfo {
  text: string;
  start: number;
}

/** Split on '\n', keeping each line's start offset. Newlines are excluded
 * from the line text but accounted for in offsets. */
function splitKeepingOffsets(body: string): LineInfo[] {
  const out: LineInfo[] = [];
  let start = 0;

  for (let i = 0; i <= body.length; i++) {
    if (i === body.length || body[i] === '\n') {
      out.push({ text: body.slice(start, i), start });
      start = i + 1;
    }
  }

  return out;
}

function inlineSpans(line: string, lineStart: number, out: Region[]): void {
  let i = 0;

  while (i < line.length) {
    if (line[i] !== '`') {
      i++;
      continue;
    }
    // Measure the opening backtick run.
    let j = i;

    while (j < line.length && line[j] === '`') j++;
    const runLen = j - i;

    // Look for a closing run of exactly runLen backticks.
    let k = j;
    let closed = false;

    while (k < line.length) {
      if (line[k] === '`') {
        let m = k;

        while (m < line.length && line[m] === '`') m++;
        if (m - k === runLen) {
          out.push([lineStart + i, lineStart + m]);
          i = m;
          closed = true;
          break;
        }
        k = m;
      } else {
        k++;
      }
    }
    if (!closed) i = j; // no closer — the run is literal text
  }
}

function escapeChar(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
