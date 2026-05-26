import type { CommitResult, GitConfig } from '../types';

/**
 * Minimal GitHub REST API client — just the two endpoints needed to
 * commit a single file:
 *
 *   GET  /repos/{owner}/{repo}/contents/{path}?ref={branch}
 *   PUT  /repos/{owner}/{repo}/contents/{path}
 *
 * No octokit / fetch wrapper — plain `fetch` keeps the bundle tiny and
 * works identically on desktop / iOS / Android (Obsidian on mobile
 * exposes the standard browser fetch).
 *
 * Rate-limit / pagination concerns: we never list / paginate, only
 * point-fetch one file. PATs have a 5000 req/hour quota — far more
 * than any human publish cadence.
 */

const API_ROOT = 'https://api.github.com';

export interface CommitFileOptions {
  /** Vault-relative path that will become the path inside the repo. */
  path: string;
  /** New file content (will be base64-encoded for the API). */
  body: string;
  /** Human-readable commit message. */
  message: string;
  /** Personal access token (resolved from secretStorage at call time). */
  token: string;
}

export interface ContentSha {
  /** SHA of the file at the target path on the target branch. */
  sha: string;
  /** Decoded current content (for diff / no-op detection). */
  content: string;
}

export class GitHubConflictError extends Error {
  constructor(message: string, public readonly remoteSha: string | undefined) {
    super(message);
    this.name = 'GitHubConflictError';
  }
}

export class GitHubRestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'GitHubRestError';
  }
}

/**
 * Fetch the current SHA + content of the file at `path` on `branch`.
 * Returns undefined if the file doesn't exist yet (404), throws on
 * any other error.
 */
export async function getContentSha(
  cfg: GitConfig,
  path: string,
  token: string,
): Promise<ContentSha | undefined> {
  const url = `${API_ROOT}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(cfg.branch)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(token),
  });

  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new GitHubRestError(
      `GET ${path} failed (${res.status})`,
      res.status,
      await res.text().catch(() => ''),
    );
  }

  const data = (await res.json()) as { sha: string; content: string; encoding: string };

  if (data.encoding !== 'base64') {
    throw new GitHubRestError(
      `unexpected content encoding "${data.encoding}" for ${path}`,
      200,
      JSON.stringify(data),
    );
  }

  return {
    sha: data.sha,
    content: decodeBase64(data.content.replaceAll('\n', '')),
  };
}

/**
 * Commit (create-or-update) a file at `path` on `branch`. Returns the
 * commit metadata. Throws GitHubConflictError on 422 (SHA mismatch — the
 * branch has moved since we read the SHA).
 */
export async function commitFile(
  cfg: GitConfig,
  opts: CommitFileOptions,
): Promise<CommitResult> {
  const current = await getContentSha(cfg, opts.path, opts.token);

  const payload: Record<string, unknown> = {
    message: opts.message,
    content: encodeBase64(opts.body),
    branch: cfg.branch,
    author: {
      name: cfg.authorName || undefined,
      email: cfg.authorEmail || undefined,
    },
    committer: {
      name: cfg.authorName || undefined,
      email: cfg.authorEmail || undefined,
    },
  };

  if (current) {
    payload.sha = current.sha;
    // If the new body matches the current body byte-for-byte, GitHub
    // would reject with "no changes". Surface as no-op so the pipeline
    // can short-circuit.
    if (current.content === opts.body) {
      return {
        sha: current.sha,
        commitUrl: '',
        htmlUrl: '',
      };
    }
  }

  const url = `${API_ROOT}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(opts.path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(opts.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.status === 422) {
    // Drain the body so we don't leak a Response — but its content adds
    // nothing to the typed error we surface, so we discard it.
    await res.text().catch(() => '');

    throw new GitHubConflictError(
      `branch ${cfg.branch} has newer commits than our base SHA — pull then retry`,
      current?.sha,
    );
  }

  if (!res.ok) {
    throw new GitHubRestError(
      `commit ${opts.path} failed (${res.status})`,
      res.status,
      await res.text().catch(() => ''),
    );
  }

  const data = (await res.json()) as {
    content: { sha: string; html_url: string };
    commit: { sha: string; html_url: string };
  };

  return {
    sha: data.commit.sha,
    commitUrl: data.commit.html_url,
    htmlUrl: data.content.html_url,
  };
}

/**
 * Revert a previously-committed file to a specific prior body.
 *
 *   - Fetches the current SHA at `path` on `branch`.
 *   - PUTs `previousBody` with that SHA, using a "Revert: ..." message.
 *   - The result is a single commit that brings the file's content back
 *     to whatever was in `previousBody`.
 *
 * Caller is responsible for ensuring `previousBody` is what they want.
 * Typical use: pipeline captures previousBody at publish time; "Undo last
 * publish" passes it back here later.
 */
export async function revertFile(
  cfg: GitConfig,
  opts: { path: string; previousBody: string; message: string; token: string },
): Promise<CommitResult> {
  return commitFile(cfg, {
    path: opts.path,
    body: opts.previousBody,
    message: opts.message,
    token: opts.token,
  });
}

/**
 * POST /repos/{o}/{r}/actions/workflows/{file}/dispatches — manually
 * trigger a workflow on the configured branch. Best-effort:
 *
 *   - 204 No Content → ok
 *   - 404 → workflow file doesn't exist OR PAT lacks `actions:read`
 *   - 403 → PAT lacks `actions:write` (or workflow is disabled in repo)
 *   - 422 → ref doesn't exist on the workflow's branch filter
 *
 * Used by the publish pipeline to close the "commit landed but Pages
 * didn't rebuild" gap that happens with REST-API-driven commits.
 */
export async function dispatchWorkflow(
  cfg: GitConfig,
  opts: { workflow: string; token: string },
): Promise<{ ok: boolean; status: number; message?: string }> {
  if (!cfg.owner || !cfg.repo || !opts.workflow || !opts.token) {
    return { ok: false, status: 0, message: 'owner/repo/workflow/token required' };
  }

  const url = `${API_ROOT}/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${encodeURIComponent(opts.workflow)}/dispatches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(opts.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: cfg.branch }),
  });

  // 204 No Content is success here.
  if (res.status === 204) return { ok: true, status: 204 };

  const message = await res.text().catch(() => '');

  return { ok: false, status: res.status, message: message || undefined };
}

/**
 * Test the token + repo by issuing GET /repos/{o}/{r}. Returns true if
 * the response is 2xx. The settings tab uses this for the "Test token"
 * button.
 */
export async function testAccess(
  cfg: GitConfig,
  token: string,
): Promise<{ ok: boolean; status: number; message?: string }> {
  if (!cfg.owner || !cfg.repo || !token) {
    return { ok: false, status: 0, message: 'owner/repo/PAT all required' };
  }

  const res = await fetch(`${API_ROOT}/repos/${cfg.owner}/${cfg.repo}`, {
    headers: authHeaders(token),
  });

  if (res.ok) return { ok: true, status: res.status };

  return {
    ok: false,
    status: res.status,
    message: await res.text().catch(() => ''),
  };
}

/* ---------- helpers ---------- */

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'forge',
  };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Encode a UTF-8 string to base64 — mobile-safe (no Node Buffer).
 */
function encodeBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function decodeBase64(s: string): string {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}
