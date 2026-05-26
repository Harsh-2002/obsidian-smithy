import type { Plugin } from 'obsidian';

import type { PluginSettings } from './types';

/**
 * Current settings schema version. Bump on breaking changes; add a migration
 * in `migrateSettings` when you do.
 */
export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: PluginSettings = {
  settingsVersion: SETTINGS_VERSION,
  site: {
    postsFolder: 'content/posts',
    siteBaseUrl: '',
    newPostsAreDrafts: false,
    engine: 'hugo',
  },
  storage: {
    preset: 'cloudflare_r2',
    bucket: '',
    endpoint: '',
    region: 'auto',
    forcePathStyle: false,
    publicUrlBase: '',
    pathTemplate: '{year}/{month}/{slug}/{filename}',
    accessKeyIdSecret: 'firstfinger.s3.access_key_id',
    secretAccessKeySecret: 'firstfinger.s3.secret_access_key',
  },
  git: {
    owner: '',
    repo: '',
    branch: 'main',
    patSecret: 'firstfinger.github.pat',
    authorName: '',
    authorEmail: '',
    commitMessageTemplate: 'publish: {slug}',
  },
};

/**
 * Load settings off disk, deep-merged with defaults so missing fields don't
 * crash the UI after schema bumps.
 */
export async function loadSettings(plugin: Plugin): Promise<PluginSettings> {
  const raw = await plugin.loadData();
  const merged = migrateSettings(
    deepMerge(DEFAULT_SETTINGS as unknown as Record<string, unknown>, raw) as
      unknown as PluginSettings,
  );

  return merged;
}

export async function saveSettings(
  plugin: Plugin,
  settings: PluginSettings,
): Promise<void> {
  await plugin.saveData(settings);
}

/**
 * Migrate older settings shapes to the current schema. No-op for v1.
 */
function migrateSettings(s: PluginSettings): PluginSettings {
  // v1 is the only shape today. Future migrations land here.
  s.settingsVersion = SETTINGS_VERSION;

  return s;
}

/**
 * Recursive object merge — defaults provide the shape, user value wins
 * when present. Plain-object only (no arrays of objects, no class merges).
 */
function deepMerge(
  base: Record<string, unknown>,
  override: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };

  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return out;
  }

  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const baseVal = base[key];

    if (
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(baseVal as Record<string, unknown>, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }

  return out;
}
