import { TFile } from 'obsidian';
import type { App, TAbstractFile } from 'obsidian';

/**
 * Detect a Hugo site config inside the active vault and pull a small
 * set of useful fields out of it for prefilling Forge settings.
 *
 * Looks for these files at the vault root, in order, and uses the
 * first match:
 *
 *   hugo.toml          (Hugo 0.110+ default)
 *   hugo.yaml
 *   hugo.yml
 *   config.toml        (legacy default)
 *   config.yaml
 *   config.yml
 *
 * Returns suggested values rather than applying them — the welcome
 * modal / settings tab presents them as "Detected: X — use this?"
 * with accept/edit/skip, never silently overrides.
 *
 * Scope: deliberately small. We only need `baseURL` and a heuristic
 * for `postsFolder`. Full TOML/YAML parsing would be overkill; a
 * targeted regex on a few keys keeps this <50 lines and bullet-proof
 * against the wider Hugo config surface (nested tables etc.).
 */

export interface HugoDetectResult {
  /** Path of the config file that was detected, vault-relative. */
  configPath: string;
  /** baseURL field, if present + parseable. */
  baseUrl?: string;
  /** True iff a `content/posts/` directory exists in the vault. */
  postsFolderExists: boolean;
}

const CANDIDATE_FILES = [
  'hugo.toml',
  'hugo.yaml',
  'hugo.yml',
  'config.toml',
  'config.yaml',
  'config.yml',
];

export async function detectHugoConfig(
  app: App,
): Promise<HugoDetectResult | null> {
  let configFile: TFile | null = null;

  for (const name of CANDIDATE_FILES) {
    const f = app.vault.getAbstractFileByPath(name);

    if (f instanceof TFile) {
      configFile = f;
      break;
    }
  }

  if (!configFile) return null;

  const src = await app.vault.cachedRead(configFile);
  const baseUrl = extractBaseUrl(src);

  // Cheap directory check.
  const contentPosts: TAbstractFile | null =
    app.vault.getAbstractFileByPath('content/posts');
  const postsFolderExists = !!contentPosts && !(contentPosts instanceof TFile);

  return {
    configPath: configFile.path,
    baseUrl,
    postsFolderExists,
  };
}

/**
 * Pull `baseURL` (or `baseurl`) out of a TOML or YAML Hugo config.
 *
 * Matches:
 *   baseURL = "https://blog.example.com"
 *   baseURL = 'https://blog.example.com'
 *   baseURL: https://blog.example.com
 *   baseURL: "https://blog.example.com"
 *
 * Ignores commented-out lines (#) and lines inside nested tables —
 * top-level only, which is where Hugo's baseURL actually lives.
 */
export function extractBaseUrl(src: string): string | undefined {
  const lines = src.split('\n');
  let inNestedTable = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (!line || line.startsWith('#')) continue;

    // Track TOML nested-table headers — once we enter one we're past
    // the top-level scope.
    if (line.startsWith('[')) {
      inNestedTable = true;
      continue;
    }
    if (inNestedTable) continue;

    const match = /^baseurl\s*[:=]\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/i.exec(
      line,
    );

    if (match) {
      const url = match[1].replace(/\/+$/, '');

      if (/^https?:\/\//i.test(url)) return url;
    }
  }

  return undefined;
}
