import { describe, expect, it } from 'vitest';

import { transformToHugo } from './transform';

describe('transformToHugo', () => {
  it('strips inline %%comments%%', () => {
    const { body } = transformToHugo('Hello %%secret note%% world');

    expect(body).toBe('Hello  world');
  });

  it('strips multi-line %%comments%%', () => {
    const { body } = transformToHugo('a\n%%\nhidden\nlines\n%%\nb');

    expect(body).toBe('a\n\nb');
  });

  it('converts ==highlight== to <mark>', () => {
    const { body } = transformToHugo('this is ==important== text');

    expect(body).toBe('this is <mark>important</mark> text');
  });

  it('leaves spaced "a == b" comparisons alone', () => {
    const { body } = transformToHugo('if a == b then');

    expect(body).toBe('if a == b then');
  });

  it('converts a basic callout with a title', () => {
    const { body } = transformToHugo('> [!note] Heads up\n> body line');

    expect(body).toBe(
      '{{< callout type="info" title="Heads up" >}}\nbody line\n{{< /callout >}}',
    );
  });

  it('maps callout types to the 4 site types', () => {
    expect(transformToHugo('> [!warning] W\n> x').body).toContain('type="warn"');
    expect(transformToHugo('> [!tip] T\n> x').body).toContain('type="success"');
    expect(transformToHugo('> [!danger] D\n> x').body).toContain('type="danger"');
    expect(transformToHugo('> [!quote] Q\n> x').body).toContain('type="info"');
  });

  it('warns on and downgrades an unknown callout type to info', () => {
    const { body, warnings } = transformToHugo('> [!bogus] Hmm\n> x');

    expect(body).toContain('type="info"');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('bogus');
  });

  it('omits the title attribute when the callout has no title', () => {
    const { body } = transformToHugo('> [!info]\n> just body');

    expect(body).toBe(
      '{{< callout type="info" >}}\njust body\n{{< /callout >}}',
    );
  });

  it('drops the fold marker on foldable callouts', () => {
    const { body } = transformToHugo('> [!tip]- Foldable\n> body');

    expect(body).toContain('{{< callout type="success" title="Foldable" >}}');
  });

  it('preserves multi-line callout bodies', () => {
    const { body } = transformToHugo('> [!note] T\n> line one\n> line two');

    expect(body).toBe(
      '{{< callout type="info" title="T" >}}\nline one\nline two\n{{< /callout >}}',
    );
  });

  it('does NOT transform inside fenced code blocks', () => {
    const src = '```md\n> [!note] T\n==x==\n%%c%%\n```';
    const { body } = transformToHugo(src);

    expect(body).toBe(src);
  });

  it('does NOT transform inside inline code', () => {
    const { body } = transformToHugo('use `==x==` literally');

    expect(body).toBe('use `==x==` literally');
  });

  it('escapes double quotes in callout titles', () => {
    const { body } = transformToHugo('> [!note] Say "hi"\n> body');

    expect(body).toContain('title="Say &quot;hi&quot;"');
  });
});
