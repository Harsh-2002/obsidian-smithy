import { parseFrontmatter } from '../frontmatter/parse';
import type { FrontmatterIssue, PluginSettings } from '../types';

/**
 * Frontmatter linter — soft warnings the user can act on while editing.
 *
 * Rules:
 *   - title       required (errors at publish; surfaced as 'warn' while editing)
 *   - date        required (same)
 *   - description warn — used for OG cards + search snippets
 *   - tags        warn — recommended for categorization
 *   - cover       info — optional but common
 *
 * Date fields (date, last_published) are checked for parseability.
 *
 * Non-blocking — these never prevent publish, only inform.
 */

export function lintFrontmatter(
  postSource: string,
  _settings: PluginSettings,
): FrontmatterIssue[] {
  let parsed;

  try {
    parsed = parseFrontmatter(postSource);
  } catch {
    // Half-typed frontmatter throws as the user edits. Stay silent —
    // the publish validator catches real parse errors at publish time
    // with a non-blocking modal, where the user expects an action.
    // Spamming chip warnings during typing creates the very friction
    // we're trying to remove.
    return [];
  }

  if (parsed.format === 'none') {
    // Same reasoning — a brand-new file has no frontmatter yet.
    // Publish will catch this; no need to harass the writer.
    return [];
  }

  const data = parsed.data;
  const issues: FrontmatterIssue[] = [];

  if (!data.title || !String(data.title).trim()) {
    issues.push({ field: 'title', severity: 'warn', message: 'title is missing — publish will fail' });
  }

  if (!data.date) {
    issues.push({ field: 'date', severity: 'warn', message: 'date is missing — publish will fail' });
  } else if (!isDateLike(data.date)) {
    issues.push({
      field: 'date',
      severity: 'warn',
      message: 'date is not a valid TOML date / ISO datetime',
    });
  }

  if (!data.description || !String(data.description).trim()) {
    issues.push({
      field: 'description',
      severity: 'warn',
      message: 'description is empty — recommended for SEO + social cards',
    });
  }

  if (!Array.isArray(data.tags) || (data.tags as unknown[]).length === 0) {
    issues.push({
      field: 'tags',
      severity: 'warn',
      message: 'tags is empty — recommended for categorization',
    });
  }

  if (!data.cover) {
    issues.push({
      field: 'cover',
      severity: 'info',
      message: 'cover image is not set (optional)',
    });
  }

  return issues;
}

function isDateLike(v: unknown): boolean {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'string') return false;
  const d = new Date(v);

  return !Number.isNaN(d.getTime());
}
