import { App, Modal, Notice, Setting, TFile } from 'obsidian';

/**
 * ConflictModal — shown when the GitHub PUT returns 422 (the branch has
 * moved since we read the SHA, i.e. someone else committed between our
 * read and our write).
 *
 * Two paths offered:
 *
 *   - Pull and retry: invoke Obsidian Git's `obsidian-git:pull` command
 *     if installed, then re-run the publish. Feature-detected so this
 *     button degrades to a helpful message if the user doesn't have
 *     Obsidian Git installed.
 *
 *   - Copy markdown: dump the rewritten markdown to clipboard so the
 *     user can resolve manually (commit via web UI, etc.).
 */

export interface ConflictModalOptions {
  /** The rewritten post body that failed to commit. */
  rewrittenBody: string;
  /** Called when "Pull and retry" succeeds — should re-run the publish. */
  onRetry: () => Promise<void>;
}

export class ConflictModal extends Modal {
  constructor(
    app: App,
    private readonly opts: ConflictModalOptions,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: 'Branch has newer commits' });
    contentEl.createEl('p', {
      text:
        'The remote branch has changed since we last read it. Pull the ' +
        "latest commits, then we'll retry the publish.",
      cls: 'setting-item-description',
    });

    const hasObsidianGit = this.hasObsidianGit();

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Pull and retry')
          .setCta()
          .setDisabled(!hasObsidianGit)
          .setTooltip(
            hasObsidianGit
              ? 'Runs Obsidian Git: Pull, then re-runs publish'
              : 'Install the Obsidian Git plugin to enable pull-and-retry',
          )
          .onClick(async () => {
            // Snapshot the active file's mtime so we can tell whether pull
            // actually changed it. If mtime doesn't move and no error was
            // raised, the pull probably no-op'd (already up to date for
            // THIS file but maybe not for another) — we still retry but
            // surface a warning so the user has context.
            const active = this.app.workspace.getActiveFile();
            const mtimeBefore = active instanceof TFile ? active.stat.mtime : 0;
            const statusEl = this.contentEl.createEl('p', {
              text: 'Pulling…',
              cls: 'setting-item-description',
            });

            try {
              const cmds = (
                this.app as App & {
                  commands?: { executeCommandById?: (id: string) => boolean };
                }
              ).commands;

              cmds?.executeCommandById?.('obsidian-git:pull');

              // Poll up to 5s for the active file's mtime to advance.
              // Obsidian's vault.on('modify') fires when isomorphic-git
              // overwrites it, so by the time we re-read .stat.mtime it
              // should reflect the new value.
              const start = Date.now();
              let changed = false;

              while (Date.now() - start < 5_000) {
                await new Promise((r) => setTimeout(r, 250));
                const current =
                  active instanceof TFile
                    ? this.app.vault.getAbstractFileByPath(active.path)
                    : null;
                const mtime =
                  current instanceof TFile ? current.stat.mtime : 0;

                if (mtime > mtimeBefore) {
                  changed = true;
                  break;
                }
              }

              statusEl.setText(changed ? 'Pull complete. Retrying…' : 'Pull finished (no local change detected). Retrying…');
              if (!changed) {
                new Notice(
                  'Smithy: pull completed but this file didn\'t change — ' +
                    'retry will likely hit the same conflict if the cause was elsewhere.',
                  10_000,
                );
              }

              await new Promise((r) => setTimeout(r, 400));
              this.close();
              await this.opts.onRetry();
            } catch (e) {
              statusEl.setText('Pull failed.');
              new Notice(
                `Pull failed: ${e instanceof Error ? e.message : String(e)}`,
                8000,
              );
            }
          }),
      )
      .addButton((b) =>
        b.setButtonText('Copy markdown').onClick(async () => {
          try {
            await navigator.clipboard.writeText(this.opts.rewrittenBody);
            new Notice('Rewritten markdown copied to clipboard.');
          } catch {
            new Notice(
              'Clipboard write failed — select + copy the post manually.',
              8000,
            );
          }
        }),
      )
      .addButton((b) =>
        b.setButtonText('Cancel').onClick(() => this.close()),
      );

    if (!hasObsidianGit) {
      contentEl.createEl('p', {
        text:
          'Tip: install the "Obsidian Git" community plugin to enable ' +
          'one-click pull-and-retry. Until then, pull from a terminal ' +
          '(or your git client) and re-run the publish.',
        cls: 'setting-item-description',
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }

  private hasObsidianGit(): boolean {
    // Feature-detect by checking the command registry. Obsidian Git
    // registers `obsidian-git:pull` (and a bunch of others) when loaded.
    // app.commands.commands is the live registry of every available command.
    const cmds = (this.app as App & { commands?: { commands?: Record<string, unknown> } })
      .commands?.commands;

    return !!cmds && 'obsidian-git:pull' in cmds;
  }
}
