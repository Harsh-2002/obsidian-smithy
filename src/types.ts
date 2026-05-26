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
}

/* ---------- Engine adapter (extensible to Jekyll/Astro later) ---------- */

export interface EngineAdapter {
  id: EngineId;
  /** Build the public URL for a post given its vault-relative file path. */
  permalinkFor(postFilePath: string, settings: PluginSettings): string;
  /** New-post markdown body + frontmatter. */
  scaffoldPost(opts: { title: string; date: Date; draft: boolean }): string;
}
