import { describe, expect, it } from 'vitest';

import { extractBaseUrl } from './hugo-config-detect';

describe('extractBaseUrl', () => {
  it('pulls baseURL out of a TOML config', () => {
    const src = `baseURL = "https://blog.example.com"
title = "My blog"
`;

    expect(extractBaseUrl(src)).toBe('https://blog.example.com');
  });

  it('pulls baseURL out of a YAML config', () => {
    const src = `baseURL: https://blog.example.com
title: My blog
`;

    expect(extractBaseUrl(src)).toBe('https://blog.example.com');
  });

  it('strips trailing slashes', () => {
    expect(extractBaseUrl('baseURL = "https://blog.example.com/"')).toBe(
      'https://blog.example.com',
    );
  });

  it('is case-insensitive on the key name', () => {
    expect(extractBaseUrl('BASEURL = "https://blog.example.com"')).toBe(
      'https://blog.example.com',
    );
    expect(extractBaseUrl('baseurl: https://blog.example.com')).toBe(
      'https://blog.example.com',
    );
  });

  it('ignores nested tables — only top-level baseURL counts', () => {
    const src = `title = "My blog"

[params]
baseURL = "https://wrong.example.com"
`;

    expect(extractBaseUrl(src)).toBeUndefined();
  });

  it('ignores commented-out baseURL lines', () => {
    const src = `# baseURL = "https://commented-out.com"
title = "My blog"
`;

    expect(extractBaseUrl(src)).toBeUndefined();
  });

  it('rejects non-http(s) values to avoid bad prefills', () => {
    expect(extractBaseUrl('baseURL = "/relative-path"')).toBeUndefined();
  });

  it('returns undefined when no baseURL key present', () => {
    expect(extractBaseUrl('title = "My blog"')).toBeUndefined();
  });
});
