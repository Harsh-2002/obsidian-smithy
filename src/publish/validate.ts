import type { TFile } from 'obsidian';

import { parseFrontmatter, type ParsedFrontmatter } from '../frontmatter/parse';
import { FrontmatterError } from '../frontmatter/parse';
import type { PluginSettings } from '../types';

/**
 * Validation result: either an OK with the parsed frontmatter + body, or
 * a failure reason to surface in the publish modal.
 */
export type ValidationResult =
  | { ok: true; frontmatter: ParsedFrontmatter; body: string; postSource: string }
  | { ok: false; reason: string };

/**
 * Required frontmatter fields for a publishable post. Missing any of these
 * is a hard fail with a friendly message.
 */
const REQUIRED_FIELDS = ['title', 'date'] as const;

export async function validatePost(
  file: TFile,
  src: string,
  settings: PluginSettings,
): Promise<ValidationResult> {
  // 1. Scope: file must live under settings.site.postsFolder
  const postsRoot = settings.site.postsFolder.replace(/\/+$/, '') + '/';

  if (!file.path.startsWith(postsRoot)) {
    return {
      ok: false,
      reason: `file is not inside the configured posts folder (${settings.site.postsFolder})`,
    };
  }

  // 2. Frontmatter must parse and have required fields.
  let fm: ParsedFrontmatter;

  try {
    fm = parseFrontmatter(src);
  } catch (e) {
    if (e instanceof FrontmatterError) {
      return { ok: false, reason: e.message };
    }
    return {
      ok: false,
      reason: `frontmatter parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (fm.format === 'none') {
    return {
      ok: false,
      reason: 'post is missing frontmatter (need +++ TOML or --- YAML block)',
    };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in fm.data) || fm.data[field] === null || fm.data[field] === '') {
      return {
        ok: false,
        reason: `frontmatter missing required field "${field}"`,
      };
    }
  }

  return { ok: true, frontmatter: fm, body: fm.body, postSource: src };
}
