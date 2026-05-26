/**
 * Shared types for forge.
 */

import type { TFile } from 'obsidian';

/* ---------- Storage ---------- */

/** S3-compatible provider preset ids. `custom` = user fills every field. */
export type ProviderPresetId =
  | 'cloudflare_r2'
  | 'aws_s3'
  | 'digitalocean_spaces'
  | 'wasabi'
  | 'backblaze_b2'
  | 'minio'
  | 'custom';

export interface StorageConfig {
  preset: ProviderPresetId;
  bucket: string;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  /** Public URL prefix (CDN domain) used to build links and detect already-published refs. */
  publicUrlBase: string;
  /** Template tokens: {year} {month} {day} {slug} {filename} {ext} {hash}. */
  pathTemplate: string;
  /** Name (NOT value) of the access key id in app.secretStorage. */
  accessKeyIdSecret: string;
  /** Name (NOT value) of the secret access key in app.secretStorage. */
  secretAccessKeySecret: string;
}

/* ---------- Git ---------- */

export interface GitConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Name (NOT value) of the GitHub PAT in app.secretStorage. */
  patSecret: string;
  authorName: string;
  authorEmail: string;
  /** Template tokens: {slug} {title} {date}. */
  commitMessageTemplate: string;
  /**
   * Workflow file name to POST to /actions/workflows/<name>/dispatches
   * after a successful commit. Empty string disables the dispatch.
   *
   * Why this exists: commits made via the REST contents API don't always
   * trigger `push` event workflows on GitHub Pages — a known quirk when
   * the commit author equals the token user. Explicitly dispatching
   * removes the "did Pages actually rebuild?" gap.
   *
   * PAT needs `actions:write` for this to succeed; a 403 here doesn't
   * fail the publish, just shows a notice.
   */
  dispatchWorkflow: string;
}

/* ---------- Site ---------- */

export type EngineId = 'hugo';

export interface SiteConfig {
  /** Folder within the vault where blog posts live, e.g. "content/posts". */
  postsFolder: string;
  /** Public URL of the blog (used to build "view live" links after publish). */
  siteBaseUrl: string;
  /** Whether new posts created via "New post" start as drafts. */
  newPostsAreDrafts: boolean;
  engine: EngineId;
}

/* ---------- Top-level ---------- */

export interface PluginSettings {
  site: SiteConfig;
  storage: StorageConfig;
  git: GitConfig;
  /** Schema version of this settings object — bumped on breaking changes. */
  settingsVersion: number;
  /** Auto-rename pasted screenshots inside the posts folder (default off). */
  autoRenameScreenshots: boolean;
  /**
   * Per-post publish history keyed by vault-relative post path. Used by
   * "Undo last publish" to revert the most recent commit. We keep only
   * the LATEST entry per post — full history is in the git log.
   */
  publishHistory: Record<string, PublishHistoryEntry>;
  /**
   * True once the user dismissed (or completed) the first-run welcome
   * modal. Prevents it from reopening on every Obsidian launch.
   */
  welcomeModalDismissed: boolean;
}

/* ---------- Publish pipeline ---------- */

export type AssetRefKind = 'image' | 'link' | 'wiki-embed' | 'wiki-link';

/** A reference to a local file (or other post) found in a post's markdown. */
export interface AssetRef {
  kind: AssetRefKind;
  /** The exact source substring that should be replaced when rewriting. */
  raw: string;
  /** The resolved target path or wikilink (relative or wikilink form). */
  target: string;
  /** Alt text / display text, if present. */
  alt?: string;
  /** Source offset in the post body — used for offset-based rewrite. */
  startIdx: number;
  endIdx: number;
}

export interface ResolvedAsset {
  ref: AssetRef;
  file: TFile;
  contentType: string;
}

export interface UploadResult {
  ref: AssetRef;
  /** Final URL on the CDN. */
  url: string;
  /** Final S3 object key. */
  key: string;
  /** True if the asset was already on the CDN (skipped re-upload). */
  skipped: boolean;
}

export interface CommitResult {
  sha: string;
  commitUrl: string;
  htmlUrl: string;
}

export type PublishWarningKind =
  | 'unresolved-link'
  | 'unresolved-embed'
  | 'unsupported-frontmatter';

export interface PublishWarning {
  kind: PublishWarningKind;
  message: string;
  ref?: AssetRef;
}

export interface PublishReport {
  postPath: string;
  uploaded: UploadResult[];
  warnings: PublishWarning[];
  commit?: CommitResult;
  livePostUrl?: string;
  /** True if this was a dry-run — no S3 PUTs / no git commits happened. */
  dryRun?: boolean;
  /**
   * True if Forge POSTed a workflow_dispatch after the commit. Absent if
   * the user disabled the dispatch by clearing GitConfig.dispatchWorkflow.
   */
  workflowDispatched?: boolean;
  /** Dispatch error message — publish itself still succeeded. */
  workflowDispatchError?: string;
}

/**
 * Per-post publish history — keyed by vault-relative post path in plugin
 * data. Capturing the previous body (decoded) and SHA lets "Undo last
 * publish" PUT the prior state back without any extra round-trips.
 */
export interface PublishHistoryEntry {
  /** When the publish committed (ISO 8601). */
  publishedAt: string;
  /** Commit URL on GitHub. */
  commitUrl: string;
  /** Commit SHA on GitHub. */
  commitSha: string;
  /** Content SHA of the file BEFORE this publish — undefined if it was a new file. */
  previousFileSha?: string;
  /** Decoded body that was on the branch BEFORE this publish — for undo. */
  previousBody?: string;
  /**
   * Local file mtime (ms epoch) captured AFTER the `last_published`
   * frontmatter writeback. Used by the status-bar chip to decide
   * "Published" vs "Unpublished changes" reliably — comparing the
   * current mtime against the in-frontmatter `last_published` date
   * is racy because writing that key bumps the mtime itself.
   */
  publishedMtime?: number;
}

/* ---------- Frontmatter lint ---------- */

export type FrontmatterIssueSeverity = 'warn' | 'info';

export interface FrontmatterIssue {
  field: string;
  message: string;
  severity: FrontmatterIssueSeverity;
}

/* ---------- Engine adapter (extensible to Jekyll/Astro later) ---------- */

export interface EngineAdapter {
  id: EngineId;
  /** Build the public URL for a post given its vault-relative file path. */
  permalinkFor(postFilePath: string, settings: PluginSettings): string;
  /** New-post markdown body + frontmatter. */
  scaffoldPost(opts: { title: string; date: Date; draft: boolean }): string;
}
