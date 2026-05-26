import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GitConfig } from '../types';

import { dispatchWorkflow } from './github-rest';

const cfg: GitConfig = {
  owner: 'me',
  repo: 'site',
  branch: 'main',
  patSecret: 'x',
  authorName: '',
  authorEmail: '',
  commitMessageTemplate: 'publish: {slug}',
  dispatchWorkflow: 'deploy.yml',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dispatchWorkflow', () => {
  it('returns ok on 204', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const r = await dispatchWorkflow(cfg, { workflow: 'deploy.yml', token: 'pat' });

    expect(r.ok).toBe(true);
    expect(r.status).toBe(204);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0];

    expect(url).toBe(
      'https://api.github.com/repos/me/site/actions/workflows/deploy.yml/dispatches',
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ ref: 'main' });
  });

  it('surfaces non-204 as ok=false with status + body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    const r = await dispatchWorkflow(cfg, { workflow: 'deploy.yml', token: 'pat' });

    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.message).toBe('Not Found');
  });

  it('short-circuits when required args are missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const r = await dispatchWorkflow(cfg, { workflow: '', token: 'pat' });

    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
