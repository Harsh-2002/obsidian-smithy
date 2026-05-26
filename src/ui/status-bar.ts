import type { App, TFile } from 'obsidian';

import type { PipelinePhase } from '../publish/pipeline';
import type { PluginSettings } from '../types';

/**
 * Status-bar chip — the always-visible Forge UI element.
 *
 * Three states, one chip:
 *
 *   1. **Off-post** (active file not a publishable post) — chip hidden.
 *   2. **Idle on a post** — shows publish freshness:
 *        "✓ Published 2h ago"           (last_published matches the latest mtime)
 *        "● Unpublished changes"         (file mtime > last_published)
 *        "○ Not yet published"           (no last_published in frontmatter)
 *   3. **Publishing** — shows current phase + spinner, clickable to open
 *      the detailed PublishModal:
 *        "⟳ Forge — Uploading 3/7"
 *
 * Click handling: when in "publishing" state, opens the publish modal
 * for detail. When idle on a post, clicking runs the publish command.
 */

const REFRESH_MS = 30_000;

export interface StatusBarHost {
  settings: PluginSettings;
  /** Invoked when the chip is clicked in idle-on-post state. */
  onChipClick(): void;
}

export class StatusBarChip {
  private readonly el: HTMLElement;
  private interval: ReturnType<typeof setInterval> | null = null;
  private publishing = false;
  private currentPhase: PipelinePhase | null = null;
  private uploadStatus = '';

  constructor(
    private readonly app: App,
    rootEl: HTMLElement,
    private readonly host: StatusBarHost,
  ) {
    this.el = rootEl;
    this.el.addClass('forge-status-bar');
    this.el.style.cursor = 'pointer';

    this.el.addEventListener('click', () => {
      this.host.onChipClick();
    });

    // Periodic re-render so "Published 2h ago" stays accurate without
    // requiring a publish to refresh it.
    this.interval = setInterval(() => this.render(), REFRESH_MS);

    // Listen for active-file changes to update the chip state.
    this.app.workspace.on('active-leaf-change', () => this.render());
    this.app.workspace.on('file-open', () => this.render());

    this.render();
  }

  destroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.el.empty();
  }

  /**
   * Called by the publish pipeline as it ticks through phases.
   */
  setPublishing(phase: PipelinePhase | null, uploadStatus = ''): void {
    this.publishing = phase !== null;
    this.currentPhase = phase;
    this.uploadStatus = uploadStatus;
    this.render();
  }

  /**
   * Called after a successful publish so the chip immediately reflects
   * the new last_published stamp without waiting for the 30s refresh.
   */
  refresh(): void {
    this.render();
  }

  /* ---------- rendering ---------- */

  private render(): void {
    this.el.empty();

    if (this.publishing) {
      this.renderPublishing();
      return;
    }

    const file = this.app.workspace.getActiveFile();

    if (!file || !this.isPost(file)) {
      // Hidden when not on a publishable file.
      this.el.style.display = 'none';
      return;
    }

    this.el.style.display = '';
    this.renderIdle(file);
  }

  private renderPublishing(): void {
    const label = phaseLabel(this.currentPhase);
    const text =
      this.currentPhase === 'upload' && this.uploadStatus
        ? `⟳ Forge — ${this.uploadStatus}`
        : `⟳ Forge — ${label}…`;

    this.el.createEl('span', { text });
    this.el.setAttr('aria-label', 'Publish in progress. Click for details.');
  }

  private renderIdle(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    const lastPublished = parseLastPublished(cache?.frontmatter?.last_published);
    const fileMtime = new Date(file.stat.mtime);

    let glyph: string;
    let text: string;

    if (!lastPublished) {
      glyph = '○';
      text = 'Forge — not yet published';
    } else if (fileMtime.getTime() > lastPublished.getTime() + 1000) {
      // 1s tolerance — the frontmatter writeback bumps the mtime a tiny
      // bit after the stamp, so a strict > would falsely flag the moment
      // of publish.
      glyph = '●';
      text = 'Forge — unpublished changes';
    } else {
      glyph = '✓';
      text = `Forge — published ${relativeTime(lastPublished)}`;
    }

    this.el.createEl('span', { text: `${glyph} ${text}` });
    this.el.setAttr(
      'aria-label',
      'Click to publish this post. Hover for last-publish details.',
    );
  }

  private isPost(file: TFile): boolean {
    if (file.extension !== 'md') return false;
    const root = this.host.settings.site.postsFolder.replace(/\/+$/, '') + '/';

    return file.path.startsWith(root);
  }
}

/* ---------- helpers ---------- */

function phaseLabel(phase: PipelinePhase | null): string {
  switch (phase) {
    case 'validate':
      return 'Validating';
    case 'walk':
      return 'Scanning';
    case 'resolve':
      return 'Resolving';
    case 'upload':
      return 'Uploading';
    case 'rewrite':
      return 'Rewriting';
    case 'commit':
      return 'Committing';
    default:
      return 'Working';
  }
}

function parseLastPublished(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  const d = new Date(value);

  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);

  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);

  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);

  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);

  if (days < 14) return `${days}d ago`;
  const weeks = Math.round(days / 7);

  if (weeks < 8) return `${weeks}w ago`;
  const months = Math.round(days / 30);

  return `${months}mo ago`;
}
