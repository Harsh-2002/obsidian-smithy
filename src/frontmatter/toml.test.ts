import { describe, expect, it } from 'vitest';

import { parseTomlFrontmatter } from './toml';

describe('parseTomlFrontmatter', () => {
  it('parses basic strings + booleans + ints', () => {
    const r = parseTomlFrontmatter(`
title = "Hello world"
draft = false
count = 42
    `);

    expect(r.title).toBe('Hello world');
    expect(r.draft).toBe(false);
    expect(r.count).toBe(42);
  });

  it('parses literal strings (single quotes)', () => {
    const r = parseTomlFrontmatter(`name = 'no \\\\n escapes here'`);

    expect(r.name).toBe('no \\\\n escapes here');
  });

  it('parses inline arrays of strings', () => {
    const r = parseTomlFrontmatter(`tags = ["devops", "self-hosted", "ai"]`);

    expect(r.tags).toEqual(['devops', 'self-hosted', 'ai']);
  });

  it('parses multi-line arrays', () => {
    const r = parseTomlFrontmatter(`
tags = [
  "alpha",
  "beta",
  "gamma",
]
    `);

    expect(r.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('parses TOML local dates', () => {
    const r = parseTomlFrontmatter(`date = 2026-05-26`);

    expect(r.date).toBeInstanceOf(Date);
    expect((r.date as Date).getUTCFullYear()).toBe(2026);
    expect((r.date as Date).getUTCMonth()).toBe(4); // 0-indexed
  });

  it('parses TOML offset datetimes', () => {
    const r = parseTomlFrontmatter(`updated = 2026-05-26T12:30:00Z`);

    expect(r.updated).toBeInstanceOf(Date);
    expect((r.updated as Date).toISOString()).toBe('2026-05-26T12:30:00.000Z');
  });

  it('strips comments after the value', () => {
    const r = parseTomlFrontmatter(`title = "Real" # this comment is dropped`);

    expect(r.title).toBe('Real');
  });

  it('ignores blank lines and standalone comments', () => {
    const r = parseTomlFrontmatter(`
# top comment
title = "Hello"

# another comment
draft = true
    `);

    expect(r.title).toBe('Hello');
    expect(r.draft).toBe(true);
  });

  it('handles escaped quotes inside basic strings', () => {
    const r = parseTomlFrontmatter(`title = "say \\"hi\\" to the world"`);

    expect(r.title).toBe('say "hi" to the world');
  });

  it('throws on tables (unsupported in v1)', () => {
    expect(() =>
      parseTomlFrontmatter(`
title = "Hello"
[author]
name = "Anurag"
`),
    ).toThrow(/[Tt]able/);
  });

  it('throws on unrecognized scalar shapes', () => {
    expect(() => parseTomlFrontmatter(`weird = notastring`)).toThrow(
      /unrecognized/,
    );
  });

  it('throws on invalid keys', () => {
    expect(() => parseTomlFrontmatter(`"weird key" = "x"`)).toThrow(
      /invalid key/,
    );
  });
});
