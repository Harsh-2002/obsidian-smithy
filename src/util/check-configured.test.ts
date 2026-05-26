import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../settings';
import type { PluginSettings } from '../types';

import { checkConfigured } from './check-configured';

function configured(): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    site: {
      ...DEFAULT_SETTINGS.site,
      postsFolder: 'content/posts',
      siteBaseUrl: 'https://blog.example.com',
    },
    storage: {
      ...DEFAULT_SETTINGS.storage,
      bucket: 'b',
      endpoint: 'https://e',
      publicUrlBase: 'https://cdn.example.com',
    },
    git: {
      ...DEFAULT_SETTINGS.git,
      owner: 'owner',
      repo: 'repo',
    },
  };
}

describe('checkConfigured', () => {
  it('reports fully ready when all 3 sections have required fields', () => {
    expect(checkConfigured(configured()).ready).toBe(true);
  });

  it('flags missing site when postsFolder is empty', () => {
    const s = configured();

    s.site.postsFolder = '';

    expect(checkConfigured(s).missing.site).toBe(true);
    expect(checkConfigured(s).ready).toBe(false);
  });

  it('flags missing storage when publicUrlBase is empty', () => {
    const s = configured();

    s.storage.publicUrlBase = '';

    expect(checkConfigured(s).missing.storage).toBe(true);
  });

  it('flags missing git when owner is empty', () => {
    const s = configured();

    s.git.owner = '';

    expect(checkConfigured(s).missing.git).toBe(true);
  });

  it('treats fresh defaults as fully unconfigured', () => {
    const r = checkConfigured(DEFAULT_SETTINGS);

    expect(r.ready).toBe(false);
    expect(r.missing.site).toBe(true);
    expect(r.missing.storage).toBe(true);
    expect(r.missing.git).toBe(true);
  });
});
