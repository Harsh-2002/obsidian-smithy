import { describe, expect, it } from 'vitest';

import { codeRegions, inCodeRegion, splitProtected } from './code-regions';

describe('codeRegions', () => {
  it('detects a fenced block', () => {
    const body = 'before\n```\ncode line\n```\nafter';
    const regions = codeRegions(body);
    const fenceStart = body.indexOf('```');

    expect(regions).toHaveLength(1);
    expect(regions[0][0]).toBe(fenceStart);
    expect(body.slice(regions[0][0], regions[0][1])).toBe('```\ncode line\n```');
  });

  it('detects a tilde fence with an info string', () => {
    const body = '~~~js\nconst x = 1;\n~~~';
    const regions = codeRegions(body);

    expect(regions).toHaveLength(1);
    expect(body.slice(regions[0][0], regions[0][1])).toBe(body);
  });

  it('treats an unterminated fence as running to EOF', () => {
    const body = 'text\n```\nno close';
    const regions = codeRegions(body);

    expect(regions).toHaveLength(1);
    expect(regions[0][1]).toBe(body.length);
  });

  it('detects inline code spans', () => {
    const body = 'use `npm run build` to compile';
    const regions = codeRegions(body);

    expect(regions).toHaveLength(1);
    expect(body.slice(regions[0][0], regions[0][1])).toBe('`npm run build`');
  });

  it('handles double-backtick inline spans containing a backtick', () => {
    const body = 'render ``a ` b`` here';
    const regions = codeRegions(body);

    expect(regions).toHaveLength(1);
    expect(body.slice(regions[0][0], regions[0][1])).toBe('``a ` b``');
  });

  it('does NOT treat a blockquote-prefixed fence as a top-level fence', () => {
    const body = '> ```\n> not a real fence open\n> ```';

    // No top-level fence; the `> ` prefix keeps it inside callout/quote text.
    expect(codeRegions(body)).toHaveLength(0);
  });

  it('inCodeRegion reports membership', () => {
    const body = 'a `code` b';
    const regions = codeRegions(body);
    const insidePos = body.indexOf('code');
    const outsidePos = body.indexOf('b');

    expect(inCodeRegion(insidePos, regions)).toBe(true);
    expect(inCodeRegion(outsidePos, regions)).toBe(false);
  });
});

describe('splitProtected', () => {
  it('round-trips to the original body', () => {
    const body = 'pre `inline` mid\n```\nfenced\n```\npost';
    const segments = splitProtected(body);

    expect(segments.map((s) => s.text).join('')).toBe(body);
  });

  it('marks code segments as code:true and prose as code:false', () => {
    const body = 'a `x` b';
    const segments = splitProtected(body);

    expect(segments).toEqual([
      { text: 'a ', code: false },
      { text: '`x`', code: true },
      { text: ' b', code: false },
    ]);
  });
});
