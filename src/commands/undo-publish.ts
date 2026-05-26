import { App, Modal, Notice, Setting, TFile } from 'obsidian';

import { revertFile } from '../git/github-rest';
import { getSecret } from '../secrets';
import type { PluginSettings } from '../types';

/**
 * "Undo last publish" — reverts the most recent commit for the active post,
 * both on GitHub (via the contents API, base SHA = current; body = prior)
 * AND locally (via vault.process). Gated by a confirmation modal because
 * the operation is destructive.
 *
 * Safety checks before committing the undo:
 *   - publishHistory has an entry for this post (no entry → "nothing to
 *     undo")
 *   - that entry carries a previousBody (sometimes the prior state was
 *     a missing file — handled separately)
 *   - the active file's local mtime hasn't been bumped since publish by
 *     a user edit (mtime > publishedAt + small slop). If it has,
 *     warn explicitly that local edits will be discarded.
 */

export function canUndoPublish(
  app: App,
  settings: PluginSettings,
): boolean {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) return false;

  return !!settings.publishHistory[file.path];
}

export async function undoLastPublishCommand(
  app: App,
  settings: PluginSettings,
  saveSettings: () => Promise<void>,
): Promise<void> {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) {
    new Notice('No active file');
    return;
  }

  const entry = settings.publishHistory[file.path];

  if (!entry) {
    new Notice('No publish history for this post — nothing to undo');
    return;
  }
  if (!entry.previousBody) {
    new Notice('Previous body unavailable — nothing to undo (was a first-time publish)');
    return;
  }

  const localMtime = file.stat.mtime;
  const publishedAt = new Date(entry.publishedAt).getTime();
  const editedAfterPublish = localMtime > publishedAt + 2000;

  const modal = new ConfirmUndoModal(app, file, entry.commitUrl, editedAfterPublish, async () => {
    try {
      const token = await getSecret(app, settings.git.patSecret);

      if (!token) {
        new Notice('GitHub PAT not set — cannot revert remotely');
        return;
      }

      const result = await revertFile(settings.git, {
        path: file.path,
        previousBody: entry.previousBody as string,
        message: `revert: undo publish of ${file.basename}`,
        token,
      });

      // Roll the local file back too.
      await app.vault.process(file, () => entry.previousBody as string);

      // Drop the history entry — there's nothing further to undo.
      delete settings.publishHistory[file.path];
      await saveSettings();

      new Notice(`Forge: undo committed — ${result.commitUrl}`, 8000);
    } catch (e) {
      new Notice(
        `Undo failed: ${e instanceof Error ? e.message : String(e)}`,
        10000,
      );
    }
  });

  modal.open();
}

class ConfirmUndoModal extends Modal {
  constructor(
    app: App,
    private readonly file: TFile,
    private readonly commitUrl: string,
    private readonly editedAfterPublish: boolean,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: 'Undo last publish' });

    contentEl.createEl('p', {
      text: `This will revert "${this.file.basename}" to its pre-publish state — both on GitHub (new "revert" commit) and locally.`,
    });

    if (this.editedAfterPublish) {
      const warn = contentEl.createEl('p');

      warn.style.color = 'var(--text-error)';
      warn.setText(
        '⚠ The local file has been edited since the last publish. Undo will overwrite those edits.',
      );
    }

    contentEl.createEl('p').createEl('a', {
      text: 'view the publish commit on GitHub',
      href: this.commitUrl,
      attr: { target: '_blank', rel: 'noopener noreferrer' },
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Undo')
          .setWarning()
          .onClick(async () => {
            this.close();
            await this.onConfirm();
          }),
      )
      .addButton((b) =>
        b.setButtonText('Cancel').onClick(() => this.close()),
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
