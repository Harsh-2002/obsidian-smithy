import { describe, expect, it } from 'vitest';

import { headingAnchor, splitLinkTarget } from './resolve';

describe('splitLinkTarget', () => {
  it('returns just the path when there is no fragment', () => {
    expect(splitLinkTarget('my-post')).toEqual({ path: 'my-post' });
  });

  it('splits a heading fragment', () => {
    expect(splitLinkTarget('my-post#Section Title')).toEqual({
      path: 'my-post',
      heading: 'Section Title',
    });
  });

  it('splits a block-reference fragment', () => {
    expect(splitLinkTarget('my-post#^abc123')).toEqual({
      path: 'my-post',
      block: 'abc123',
    });
  });

  it('strips an alias defensively', () => {
    expect(splitLinkTarget('my-post#Heading|nice text')).toEqual({
      path: 'my-post',
      heading: 'Heading',
    });
  });
});

describe('headingAnchor', () => {
  it('appends a slugified heading anchor', () => {
    expect(headingAnchor('/posts/foo/', 'My Big Section')).toBe(
      '/posts/foo/#my-big-section',
    );
  });

  it('returns the permalink unchanged for an empty heading', () => {
    expect(headingAnchor('/posts/foo/', '   ')).toBe('/posts/foo/');
  });
});
