import { App, Modal, Notice, Setting, TFile } from 'obsidian';

import { publishPost, PipelineError } from '../publish/pipeline';
import type { PluginSettings } from '../types';

/**
 * "Publish all drafts" — find every post under the configured posts
 * folder that is BOTH `draft: true` AND modified since its
 * `last_published` (or never published). Show a batch modal with
 * per-row Publish/Skip buttons; serial pipeline as the user approves
 * each row.
 *
 * Per-post failure does NOT block the remaining queue — the row marks
 * ✗ failed but the user can still publish the rest.
 */
export async function publishAllDraftsCommand(
  app: App,
  settings: PluginSettings,
  saveSettings: () => Promise<void>,
): Promise<void> {
  const candidates = await collectDraftCandidates(app, settings);

  if (candidates.length === 0) {
    new Notice('Smithy: no drafts to publish');
    return;
  }

  new BatchPublishModal(app, settings, candidates, saveSettings).open();
}

/* ---------- collector ---------- */

interface Candidate {
  file: TFile;
}

async function collectDraftCandidates(
  app: App,
  settings: PluginSettings,
): Promise<Candidate[]> {
  const postsRoot = settings.site.postsFolder.replace(/\/+$/, '') + '/';
  const out: Candidate[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(postsRoot)) continue;

    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    if (!fm) continue;
    if (fm.draft !== true) continue;

    const lastPublished = fm.last_published
      ? new Date(String(fm.last_published)).getTime()
      : 0;

    if (file.stat.mtime <= lastPublished + 1000) continue;

    out.push({ file });
  }

  // Newest-modified first so the user sees the most-recently-touched
  // drafts at the top.
  out.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);

  return out;
}

/* ---------- batch modal ---------- */

class BatchPublishModal extends Modal {
  private rowEls = new Map<string, HTMLElement>();

  constructor(
    app: App,
    private readonly settings: PluginSettings,
    private readonly candidates: Candidate[],
    private readonly saveSettings: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: 'Publish drafts' });
    contentEl.createEl('p', {
      text:
        `Found ${this.candidates.length} draft(s) with unpublished changes. ` +
        'Approve or skip each one — they\'ll publish serially.',
      cls: 'setting-item-description',
    });

    const list = contentEl.createDiv({ cls: 'smithy-batch-list' });

    for (const c of this.candidates) {
      const row = list.createDiv({ cls: 'smithy-batch-row' });
      const meta = row.createDiv({ cls: 'smithy-batch-meta' });

      meta.createEl('strong', { text: c.file.basename });
      meta.createEl('span', {
        text: ` — ${c.file.path}`,
        cls: 'setting-item-description',
      });

      const status = row.createDiv({ cls: 'smithy-batch-status' });

      status.setText('Pending');

      const buttons = row.createDiv({ cls: 'smithy-batch-buttons' });

      const pubBtn = buttons.createEl('button', { text: 'Publish' });

      pubBtn.addEventListener('click', async () => {
        pubBtn.disabled = true;
        status.setText('Publishing…');
        try {
          await publishPost(this.app, c.file, this.settings, {
            onCommitted: async (entry) => {
              this.settings.publishHistory[c.file.path] = entry;
              await this.saveSettings();
            },
          });
          status.setText('✓ Done');
          status.style.color = 'var(--text-success)';
        } catch (e) {
          const msg =
            e instanceof PipelineError
              ? `${e.phase}: ${e.message}`
              : e instanceof Error
                ? e.message
                : String(e);

          status.setText(`✗ ${msg}`);
          status.style.color = 'var(--text-error)';
        }
      });

      const skipBtn = buttons.createEl('button', { text: 'Skip' });

      skipBtn.addEventListener('click', () => {
        status.setText('— skipped');
        pubBtn.disabled = true;
        skipBtn.disabled = true;
      });

      this.rowEls.set(c.file.path, row);
    }

    new Setting(contentEl).addButton((b) =>
      b.setButtonText('Done').onClick(() => this.close()),
    );
  }

  onClose() {
    this.contentEl.empty();
    this.rowEls.clear();
  }
}
