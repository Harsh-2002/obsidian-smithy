import { describe, expect, it } from 'vitest';

import { HugoEngine } from './hugo';

describe('HugoEngine.scaffoldPost', () => {
  const opts = { title: 'My Post', date: new Date('2026-05-28T00:00:00Z'), draft: true };

  it('emits a YAML block for format "yaml"', () => {
    const out = HugoEngine.scaffoldPost({ ...opts, format: 'yaml' });

    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('title: "My Post"');
    expect(out).toContain('date: 2026-05-28');
    expect(out).toContain('draft: true');
    expect(out).not.toContain('+++');
  });

  it('emits a TOML block for format "toml"', () => {
    const out = HugoEngine.scaffoldPost({ ...opts, format: 'toml' });

    expect(out.startsWith('+++\n')).toBe(true);
    expect(out).toContain('title = "My Post"');
    expect(out).toContain('date = 2026-05-28');
    expect(out).toContain('draft = true');
    expect(out).not.toContain('---');
  });
});
