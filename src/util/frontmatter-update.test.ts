import { describe, expect, it } from 'vitest';

import { updateFrontmatter } from './frontmatter-update';

describe('updateFrontmatter', () => {
  const tomlPost = `+++
title = "Hello"
date = 2026-05-26
+++

Body here.
`;

  it('updates an existing TOML key in place', () => {
    const out = updateFrontmatter(tomlPost, 'title', 'Updated');

    expect(out).toContain('title = "Updated"');
    expect(out).toContain('date = 2026-05-26');
    expect(out).toContain('Body here.');
  });

  it('appends a new TOML datetime key (unquoted RFC3339) before closing +++', () => {
    const out = updateFrontmatter(tomlPost, 'last_published', new Date('2026-05-26T10:00:00Z'));

    // TOML treats RFC3339 datetimes as a primitive type — no quotes.
    expect(out).toMatch(/last_published = 2026-05-26T10:00:00\.000Z/);
    // body should still be there
    expect(out).toContain('Body here.');
    // closing delimiter still present
    expect(out.split('+++').length).toBe(3);
  });

  it('serializes booleans as TOML literals', () => {
    const out = updateFrontmatter(tomlPost, 'draft', true);

    expect(out).toContain('draft = true');
  });

  it('writes the value with escaped quotes', () => {
    const out = updateFrontmatter(tomlPost, 'title', 'say "hi"');

    expect(out).toContain('title = "say \\"hi\\""');
  });

  it('synthesizes a frontmatter block when none exists', () => {
    const noFm = 'Just body text.\n';
    const out = updateFrontmatter(noFm, 'title', 'New');

    expect(out.startsWith('+++')).toBe(true);
    expect(out).toContain('title = "New"');
    expect(out).toContain('Just body text.');
  });

  it('updates a YAML key in place when frontmatter is YAML', () => {
    const yamlPost = `---
title: Hello
date: 2026-05-26
---

Body.
`;
    const out = updateFrontmatter(yamlPost, 'title', 'Updated');

    expect(out).toContain('title: Updated');
    // YAML block still intact
    expect(out.split('---').length).toBe(3);
  });

  it('quotes YAML values that contain special chars', () => {
    const yamlPost = `---
title: Hello
---

Body.
`;
    const out = updateFrontmatter(yamlPost, 'colons', 'a: b');

    // YAML emitter chooses single-quote wrapping for values with `:`
    expect(out).toMatch(/colons: 'a: b'/);
  });

  it('is a no-op when the body has unparseable frontmatter (returns unchanged)', () => {
    const broken = '+++\nunterminated\n';
    const out = updateFrontmatter(broken, 'k', 'v');

    // No closing delimiter — function returns src unchanged rather than mangle.
    expect(out).toBe(broken);
  });
});
