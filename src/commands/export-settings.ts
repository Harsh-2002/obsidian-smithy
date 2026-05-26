import { App, Modal, Notice, Setting, TFile } from 'obsidian';

import { getSecret } from '../secrets';
import { encryptJson } from '../util/settings-crypto';
import type { PluginSettings } from '../types';

/**
 * "Forge: Export settings…" — bundle the entire plugin config PLUS the
 * three secrets (PAT, S3 access key, S3 secret) into a passphrase-
 * encrypted JSON file inside the vault.
 *
 * Why bundle secrets too: cross-device setup is a documented friction
 * (Anurag's feedback). Forcing users to re-enter 3 secrets per device
 * is exactly the wall this command knocks down. Encryption ensures
 * that the resulting file is safe to ride the vault via any sync
 * mechanism (Obsidian Sync, iCloud, Dropbox, Working Copy…).
 *
 * File default: `forge-settings.forge-config` at vault root. Path is
 * editable in the modal — power users can drop it anywhere.
 */
export async function exportSettingsCommand(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  new ExportModal(app, settings).open();
}

class ExportModal extends Modal {
  private passphrase = '';
  private confirm = '';
  private outputPath = 'forge-settings.forge-config';

  constructor(
    app: App,
    private readonly settings: PluginSettings,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: 'Export Forge settings' });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text:
        'Bundles your settings AND secrets into one encrypted file. ' +
        "Drop it into the vault, sync to another device, then run " +
        '"Forge: Import settings…" with the same passphrase. Pick ' +
        "something you'll remember — there's no recovery if the " +
        'passphrase is lost.',
    });

    new Setting(contentEl)
      .setName('Output file (inside vault)')
      .addText((t) =>
        t.setValue(this.outputPath).onChange((v) => {
          this.outputPath = v.trim();
        }),
      );

    new Setting(contentEl)
      .setName('Passphrase')
      .addText((t) => {
        t.inputEl.type = 'password';
        t.onChange((v) => {
          this.passphrase = v;
        });
      });

    new Setting(contentEl)
      .setName('Confirm passphrase')
      .addText((t) => {
        t.inputEl.type = 'password';
        t.onChange((v) => {
          this.confirm = v;
        });
      });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Export')
          .setCta()
          .onClick(async () => {
            await this.runExport();
          }),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }

  private async runExport(): Promise<void> {
    if (!this.passphrase) {
      new Notice('Enter a passphrase');
      return;
    }
    if (this.passphrase !== this.confirm) {
      new Notice('Passphrases do not match');
      return;
    }
    if (this.passphrase.length < 8) {
      new Notice('Passphrase must be at least 8 characters');
      return;
    }
    if (!this.outputPath) {
      new Notice('Pick an output path');
      return;
    }

    try {
      const [accessKey, secretKey, pat] = await Promise.all([
        getSecret(this.app, this.settings.storage.accessKeyIdSecret),
        getSecret(this.app, this.settings.storage.secretAccessKeySecret),
        getSecret(this.app, this.settings.git.patSecret),
      ]);

      // Strip the publishHistory map — it's per-vault state, not config.
      // Importing it on another device would polute that device's chip
      // with stale "Published" timestamps for posts that may not even
      // be opened there.
      const settingsCopy: Omit<PluginSettings, 'publishHistory'> & {
        publishHistory?: never;
      } = {
        ...this.settings,
        publishHistory: undefined,
      };

      delete settingsCopy.publishHistory;

      const bundle = await encryptJson(
        {
          schema: 'forge-export.v1',
          createdAt: new Date().toISOString(),
          settings: settingsCopy,
          secrets: {
            // Stored under their SECRET NAMES so the import can rewrite
            // them under the same names on the target vault.
            [this.settings.storage.accessKeyIdSecret]: accessKey ?? null,
            [this.settings.storage.secretAccessKeySecret]: secretKey ?? null,
            [this.settings.git.patSecret]: pat ?? null,
          },
        },
        this.passphrase,
      );

      const serialized = JSON.stringify(bundle, null, 2);

      // Write to the chosen vault path. Overwrite if it already exists.
      const existing = this.app.vault.getAbstractFileByPath(this.outputPath);

      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, serialized);
      } else {
        await this.app.vault.create(this.outputPath, serialized);
      }

      new Notice(
        `Exported to ${this.outputPath} — keep the passphrase safe.`,
        8000,
      );
      this.close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      new Notice(`Export failed: ${msg}`, 10000);
    }
  }
}
