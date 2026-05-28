import { describe, expect, it } from 'vitest';

import { walkMarkdown } from './walker';

describe('walkMarkdown', () => {
  it('emits an image ref for ![alt](src) with local src', () => {
    const refs = walkMarkdown('Hello ![pic](photo.png) world');

    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe('image');
    expect(refs[0].target).toBe('photo.png');
    expect(refs[0].alt).toBe('pic');
    expect(refs[0].raw).toBe('![pic](photo.png)');
  });

  it('emits a link ref for [text](src) with local src', () => {
    const refs = walkMarkdown('See [spec](docs/spec.pdf) for details');

    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe('link');
    expect(refs[0].target).toBe('docs/spec.pdf');
  });

  it('skips remote http(s) URLs', () => {
    const refs = walkMarkdown(
      'visit [google](https://google.com) or [ftp](ftp://example.com)',
    );

    expect(refs).toHaveLength(0);
  });

  it('skips mailto: tel: data: anchors and absolute paths', () => {
    const refs = walkMarkdown(`
      [mail](mailto:foo@bar.com)
      [phone](tel:+1)
      [data](data:text/plain;base64,aGVsbG8=)
      [anchor](#section)
      [abs](/posts/foo)
    `);

    expect(refs).toHaveLength(0);
  });

  it('emits wiki-embed for ![[file.png]]', () => {
    const refs = walkMarkdown('Here is an image ![[screenshot.png]] inline');

    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe('wiki-embed');
    expect(refs[0].target).toBe('screenshot.png');
    expect(refs[0].raw).toBe('![[screenshot.png]]');
  });

  it('emits wiki-link for [[other-post]]', () => {
    const refs = walkMarkdown('Related: [[other-post]] is great.');

    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe('wiki-link');
    expect(refs[0].target).toBe('other-post');
    expect(refs[0].alt).toBeUndefined();
  });

  it('extracts the alias from [[target|alias]]', () => {
    const refs = walkMarkdown('See [[my-post|the great post]] for context.');

    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe('wiki-link');
    expect(refs[0].target).toBe('my-post');
    expect(refs[0].alt).toBe('the great post');
  });

  it('preserves startIdx/endIdx offsets for rewrites', () => {
    const body = 'A ![pic](photo.png) B';
    const refs = walkMarkdown(body);

    expect(body.slice(refs[0].startIdx, refs[0].endIdx)).toBe('![pic](photo.png)');
  });

  it('sorts refs by startIdx', () => {
    const refs = walkMarkdown(
      '[[first]] then ![image](pic.png) then [[second]]',
    );

    expect(refs.map((r) => r.target)).toEqual(['first', 'pic.png', 'second']);
  });

  it('handles a wiki-link directly preceded by !', () => {
    const refs = walkMarkdown('embed: ![[clip.mp4]]');

    expect(refs[0].kind).toBe('wiki-embed');
    expect(refs[0].raw).toBe('![[clip.mp4]]');
  });

  it('skips refs inside a fenced code block', () => {
    const refs = walkMarkdown(
      'real ![a](real.png)\n```md\n![ex](example.png)\n[[not-a-link]]\n```\n',
    );

    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('real.png');
  });

  it('skips refs inside inline code', () => {
    const refs = walkMarkdown('write `![alt](path.png)` to embed');

    expect(refs).toHaveLength(0);
  });

  it('mixes all 4 kinds in one body', () => {
    const refs = walkMarkdown(`
![img](one.png)
[doc](one.pdf)
![[two.png]]
[[other-post]]
[ext](https://google.com)
`);

    const kinds = refs.map((r) => r.kind).sort();

    expect(kinds).toEqual(['image', 'link', 'wiki-embed', 'wiki-link']);
  });
});
