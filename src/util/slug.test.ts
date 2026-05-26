import { describe, expect, it } from 'vitest';

import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('preserves digits + underscores', () => {
    expect(slugify('Post_2026')).toBe('post_2026');
  });

  it('collapses multiple dashes', () => {
    expect(slugify('Hello -- World')).toBe('hello-world');
  });

  it('trims leading + trailing dashes', () => {
    expect(slugify('  Hello  ')).toBe('hello');
  });

  it('strips accent marks', () => {
    expect(slugify('Café Naïve')).toBe('cafe-naive');
  });

  it('returns "untitled" for empty input', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('!!!')).toBe('untitled');
  });
});
