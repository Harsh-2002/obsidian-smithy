import { Notice } from 'obsidian';
import type { App, EventRef, TFile } from 'obsidian';

import { lintFrontmatter } from '../publish/lint';
import type { PipelinePhase } from '../publish/pipeline';
import type { FrontmatterIssue, PluginSettings } from '../types';

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
  /** Last lint outcome for the currently-active post (or empty). */
  private lintIssues: FrontmatterIssue[] = [];
  /** Debounce handle for the lint scan. */
  private lintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Obsidian event refs we own and must release on destroy. */
  private eventRefs: EventRef[] = [];

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
    this.eventRefs.push(
      this.app.workspace.on('active-leaf-change', () => {
        this.scheduleLint();
        this.render();
      }),
    );
    this.eventRefs.push(
      this.app.workspace.on('file-open', () => {
        this.scheduleLint();
        this.render();
      }),
    );

    // Re-lint + re-render when the active file's content changes.
    this.eventRefs.push(
      this.app.vault.on('modify', (file) => {
        const active = this.app.workspace.getActiveFile();

        if (active && file.path === active.path) {
          this.scheduleLint();
          // Immediate render so "Unpublished changes" surfaces the moment
          // the user touches the file.
          this.render();
        }
      }),
    );

    // The metadataCache re-parses asynchronously after a vault write.
    // Right after publish the frontmatter we just wrote ISN'T in the
    // cache yet; refreshing on `changed` is what makes the chip show
    // "Published just now" the instant Obsidian sees the new
    // last_published key, instead of "Not yet published".
    this.eventRefs.push(
      this.app.metadataCache.on('changed', (file) => {
        const active = this.app.workspace.getActiveFile();

        if (active && file.path === active.path) this.render();
      }),
    );

    this.scheduleLint();
    this.render();
  }

  destroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.lintTimer) {
      clearTimeout(this.lintTimer);
      this.lintTimer = null;
    }
    for (const ref of this.eventRefs) {
      this.app.workspace.offref(ref);
    }
    this.eventRefs = [];
    this.el.empty();
  }

  /** True while the pipeline is actively running. Used to gate chip clicks. */
  isPublishing(): boolean {
    return this.publishing;
  }

  /** True if there's at least one `warn`-severity lint issue. */
  hasLintIssues(): boolean {
    return this.lintIssues.some((i) => i.severity === 'warn');
  }

  /** Open a Notice listing the current lint issues. Called on chip click. */
  showLintDetail(): void {
    if (this.lintIssues.length === 0) {
      new Notice('Forge — no lint issues 👍', 4000);
      return;
    }

    const body = this.lintIssues
      .map((i) => `${i.severity === 'warn' ? '⚠' : 'ℹ'} ${i.field}: ${i.message}`)
      .join('\n');

    new Notice(`Forge lint:\n${body}`, 10_000);
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
    const history = this.host.settings.publishHistory[file.path];
    const fileMtime = file.stat.mtime;

    let glyph: string;
    let text: string;

    if (!lastPublished && !history?.publishedMtime) {
      glyph = '○';
      text = 'Forge — not yet published';
    } else if (history?.publishedMtime) {
      // Authoritative comparison: mtime-vs-mtime, no race with the
      // frontmatter write. `publishedMtime` was captured AFTER the
      // last_published writeback so any later write means the user
      // actually edited.
      if (fileMtime > history.publishedMtime + 1000) {
        glyph = '●';
        text = 'Forge — unpublished changes';
      } else {
        const stampDate =
          lastPublished ?? new Date(history.publishedAt);

        glyph = '✓';
        text = `Forge — published ${relativeTime(stampDate)}`;
      }
    } else if (
      lastPublished &&
      fileMtime > lastPublished.getTime() + 1000
    ) {
      // Fallback for posts published before v0.5 (no publishedMtime in
      // history). 1s tolerance — the frontmatter writeback bumps mtime
      // a tiny bit after the stamp.
      glyph = '●';
      text = 'Forge — unpublished changes';
    } else {
      glyph = '✓';
      text = `Forge — published ${relativeTime(lastPublished as Date)}`;
    }

    // Surface lint warnings as a trailing badge so the chip stays compact
    // but signals attention.
    const warnCount = this.lintIssues.filter((i) => i.severity === 'warn').length;
    const trailing = warnCount > 0 ? `  ⚠ ${warnCount}` : '';

    this.el.createEl('span', { text: `${glyph} ${text}${trailing}` });
    this.el.setAttr(
      'aria-label',
      warnCount > 0
        ? `${warnCount} frontmatter warning(s). Click to view.`
        : 'Click to publish this post.',
    );
  }

  /* ---------- lint ---------- */

  private scheduleLint(): void {
    if (this.lintTimer) clearTimeout(this.lintTimer);
    this.lintTimer = setTimeout(() => {
      this.runLint();
    }, 2000);
  }

  private async runLint(): Promise<void> {
    const file = this.app.workspace.getActiveFile();

    if (!file || !this.isPost(file)) {
      if (this.lintIssues.length > 0) {
        this.lintIssues = [];
        this.render();
      }
      return;
    }

    try {
      const src = await this.app.vault.cachedRead(file);

      this.lintIssues = lintFrontmatter(src, this.host.settings);
    } catch {
      this.lintIssues = [];
    }

    this.render();
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
