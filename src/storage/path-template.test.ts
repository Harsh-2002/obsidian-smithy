import { describe, expect, it } from 'vitest';

import { renderKey, slugifyFilename } from './path-template';

describe('slugifyFilename', () => {
  it('lowercases + collapses whitespace into dashes', () => {
    expect(slugifyFilename('My Vacation Photo.jpg')).toBe('my-vacation-photo.jpg');
  });

  it('strips parentheses and other unsafe chars', () => {
    expect(slugifyFilename('photo (1).png')).toBe('photo-1.png');
  });

  it('normalizes accented characters', () => {
    expect(slugifyFilename('cafés.jpg')).toBe('cafes.jpg');
  });

  it('preserves trailing extension lowercased', () => {
    expect(slugifyFilename('SCREENSHOT.PNG')).toBe('screenshot.png');
  });

  it('handles filenames without an extension', () => {
    expect(slugifyFilename('My File')).toBe('my-file');
  });

  it('trims leading/trailing dashes', () => {
    expect(slugifyFilename('   weird name   .txt')).toBe('weird-name.txt');
  });

  it('strips non-ASCII chars from the extension', () => {
    expect(slugifyFilename('photo.JPG ')).toBe('photo.jpg');
  });
});

describe('renderKey', () => {
  const date = new Date('2026-05-26T10:30:00Z');
  const bytes = new TextEncoder().encode('test').buffer;

  it('substitutes {year}/{month}/{slug}/{filename}', async () => {
    const key = await renderKey('{year}/{month}/{slug}/{filename}', {
      date,
      slug: 'my-post',
      filename: 'photo.jpg',
      bytes,
    });

    expect(key).toBe('2026/05/my-post/photo.jpg');
  });

  it('handles {day} and zero-pads single-digit months', async () => {
    const jan = new Date('2026-01-03T00:00:00Z');
    const key = await renderKey('{year}/{month}/{day}/{filename}', {
      date: jan,
      slug: 'irrelevant',
      filename: 'x.png',
      bytes,
    });

    expect(key).toBe('2026/01/03/x.png');
  });

  it('substitutes {ext}', async () => {
    const key = await renderKey('uploads/{slug}-{ext}', {
      date,
      slug: 'post',
      filename: 'cover.WEBP',
      bytes,
    });

    expect(key).toBe('uploads/post-webp');
  });

  it('substitutes {hash} with the first 8 hex chars of SHA-256', async () => {
    const key = await renderKey('{hash}/{filename}', {
      date,
      slug: 'x',
      filename: 'a.txt',
      bytes,
    });

    // SHA-256("test") = 9f86d081884c... → first 8 chars
    expect(key).toBe('9f86d081/a.txt');
  });

  it('preserves literal path segments not matching any token', async () => {
    const key = await renderKey('static/images/{slug}/{filename}', {
      date,
      slug: 'foo',
      filename: 'bar.png',
      bytes,
    });

    expect(key).toBe('static/images/foo/bar.png');
  });

  it('slugifies the filename inserted by {filename}', async () => {
    const key = await renderKey('{slug}/{filename}', {
      date,
      slug: 'post',
      filename: 'My Photo (1).PNG',
      bytes,
    });

    expect(key).toBe('post/my-photo-1.png');
  });

  it('defends against a misnamed slug', async () => {
    const key = await renderKey('{slug}/file', {
      date,
      slug: '   ',
      filename: 'f.txt',
      bytes,
    });

    // Empty slug after sanitize defaults to "post"
    expect(key).toBe('post/file');
  });
});
