import { splitProtected } from '../util/code-regions';
import type { PublishWarning } from '../types';

/**
 * Obsidian → Hugo body transform.
 *
 * Converts Obsidian-flavored markdown that Goldmark would render wrong
 * into faithful Hugo markdown. Runs ONLY on the copy committed to git —
 * never written back to the vault, so the author keeps Obsidian syntax in
 * their editor.
 *
 * Transforms (all code-fence / inline-code safe via `splitProtected`):
 *
 *   1. Strip `%%comments%%`        — Obsidian comments leak as visible text.
 *   2. Callouts `> [!type] title`  → `{{< callout type=… title=… >}}…{{< /callout >}}`
 *   3. Highlights `==text==`       → `<mark>text</mark>`
 *
 * Frontmatter is NOT handled here — the caller passes the BODY only (the
 * pipeline splits it off with parseFrontmatter().bodyOffset and re-prepends
 * the original frontmatter block byte-for-byte).
 */

export interface TransformResult {
  body: string;
  warnings: PublishWarning[];
}

export function transformToHugo(body: string): TransformResult {
  const warnings: PublishWarning[] = [];
  const out = splitProtected(body)
    .map((seg) => (seg.code ? seg.text : transformText(seg.text, warnings)))
    .join('');

  return { body: out, warnings };
}

/* ---------- text-segment transforms ---------- */

function transformText(text: string, warnings: PublishWarning[]): string {
  let t = stripComments(text);

  t = convertCallouts(t, warnings);
  t = convertHighlights(t);

  return t;
}

/** Remove `%%…%%` (inline or multi-line). Requires a matching closer. */
function stripComments(text: string): string {
  return text.replace(/%%[\s\S]*?%%/g, '');
}

/**
 * `==text==` → `<mark>text</mark>`. The inner content must start and end
 * with a non-space char so prose like `a == b` (comparison) is left alone.
 */
function convertHighlights(text: string): string {
  return text.replace(/==(\S(?:[^\n]*?\S)?|\S)==/g, '<mark>$1</mark>');
}

/* ---------- callouts ---------- */

type SiteCalloutType = 'info' | 'warn' | 'success' | 'danger';

const CALLOUT_TYPE_MAP: Record<string, SiteCalloutType> = {
  note: 'info',
  info: 'info',
  abstract: 'info',
  summary: 'info',
  tldr: 'info',
  example: 'info',
  quote: 'info',
  cite: 'info',
  todo: 'info',
  tip: 'success',
  hint: 'success',
  important: 'success',
  success: 'success',
  check: 'success',
  done: 'success',
  warning: 'warn',
  caution: 'warn',
  attention: 'warn',
  question: 'warn',
  help: 'warn',
  faq: 'warn',
  danger: 'danger',
  error: 'danger',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  bug: 'danger',
};

// `> [!type]<fold?> <title?>` — fold marker `-`/`+` is dropped.
const CALLOUT_OPEN = /^\s*>\s*\[!(\w+)\][+-]?\s*(.*)$/;
// Any blockquote continuation line.
const QUOTE_LINE = /^\s*>\s?(.*)$/;

function convertCallouts(text: string, warnings: PublishWarning[]): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const open = CALLOUT_OPEN.exec(lines[i]);

    if (!open) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const rawType = open[1].toLowerCase();
    const type = CALLOUT_TYPE_MAP[rawType] ?? 'info';
    const title = open[2].trim();

    // Consume following blockquote lines as the callout body.
    const bodyLines: string[] = [];
    let j = i + 1;

    while (j < lines.length) {
      const cont = QUOTE_LINE.exec(lines[j]);

      if (!cont) break;
      bodyLines.push(cont[1]);
      j++;
    }

    if (!(rawType in CALLOUT_TYPE_MAP)) {
      warnings.push({
        kind: 'unsupported-frontmatter',
        message: `unknown callout type "[!${rawType}]" → rendered as "info"`,
      });
    }

    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';

    out.push(`{{< callout type="${type}"${titleAttr} >}}`);
    // Trim a single trailing blank body line for tidy output.
    while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') {
      bodyLines.pop();
    }
    out.push(...bodyLines);
    out.push('{{< /callout >}}');

    i = j;
  }

  return out.join('\n');
}

function escapeAttr(s: string): string {
  return s.replaceAll('"', '&quot;');
}
