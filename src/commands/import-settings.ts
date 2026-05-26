import { App, Modal, Notice, Setting, TFile } from 'obsidian';

import { setSecret } from '../secrets';
import { decryptJson, type EncryptedBundle } from '../util/settings-crypto';
import type { PluginSettings } from '../types';

/**
 * "Forge: Import settings…" — counterpart to exportSettingsCommand.
 *
 * Reads an encrypted `.forge-config` file from the vault, prompts for
 * the passphrase, decrypts, merges the contained settings into the
 * current plugin state, and writes the bundled secrets into
 * app.secretStorage. After this the target device is fully configured.
 *
 * Safety:
 *   - Asks before clobbering existing settings.
 *   - Refuses to overwrite settings if the schema field doesn't match.
 *   - Wrong passphrase produces a clear error and leaves settings
 *     untouched (decryption fails closed before any state mutation).
 */
export async function importSettingsCommand(
  app: App,
  currentSettings: PluginSettings,
  applySettings: (next: PluginSettings) => Promise<void>,
): Promise<void> {
  new ImportModal(app, currentSettings, applySettings).open();
}

interface ExportPayload {
  schema: string;
  createdAt: string;
  settings: PluginSettings;
  secrets: Record<string, string | null>;
}

class ImportModal extends Modal {
  private passphrase = '';
  private inputPath = 'forge-settings.forge-config';

  constructor(
    app: App,
    private readonly currentSettings: PluginSettings,
    private readonly applySettings: (next: PluginSettings) => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: 'Import Forge settings' });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text:
        'Loads an encrypted settings file from your vault and applies ' +
        'it to this device. Useful for moving a configured Forge from ' +
        'desktop to iPhone (or anywhere else). The 3 secrets ride along ' +
        'so you only enter the passphrase here, not the keys.',
    });

    new Setting(contentEl)
      .setName('Input file (inside vault)')
      .addText((t) =>
        t.setValue(this.inputPath).onChange((v) => {
          this.inputPath = v.trim();
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
      .addButton((b) =>
        b
          .setButtonText('Import')
          .setCta()
          .onClick(async () => {
            await this.runImport();
          }),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }

  private async runImport(): Promise<void> {
    if (!this.passphrase) {
      new Notice('Enter the passphrase you used to export');
      return;
    }
    if (!this.inputPath) {
      new Notice('Pick the input file path');
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(this.inputPath);

    if (!(file instanceof TFile)) {
      new Notice(`File not found at ${this.inputPath}`);
      return;
    }

    let payload: ExportPayload;

    try {
      const raw = await this.app.vault.read(file);
      const bundle = JSON.parse(raw) as EncryptedBundle;

      payload = await decryptJson<ExportPayload>(bundle, this.passphrase);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      new Notice(`Import failed: ${msg}`, 10000);
      return;
    }

    if (!payload.schema || !payload.schema.startsWith('forge-export.')) {
      new Notice('File is not a Forge settings export');
      return;
    }

    try {
      // Preserve per-vault state that should never be overwritten by an
      // import (publishHistory, welcomeModalDismissed). Everything else
      // comes from the bundle.
      const merged: PluginSettings = {
        ...payload.settings,
        publishHistory: this.currentSettings.publishHistory,
        welcomeModalDismissed: true,
      };

      await this.applySettings(merged);

      // Write each secret into secretStorage under its bundled NAME.
      // The names live in settings.storage.* / settings.git.* — we
      // overwrote those above, so iterating the bundle's secrets gives
      // us the names to use.
      for (const [name, value] of Object.entries(payload.secrets)) {
        if (typeof value === 'string' && value.length > 0) {
          await setSecret(this.app, name, value);
        }
      }

      new Notice(
        `Imported ✓ — exported ${humanAge(payload.createdAt)}. ` +
          'Run Test all in Settings to verify.',
        10000,
      );
      this.close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      new Notice(`Apply failed: ${msg}`, 10000);
    }
  }
}

function humanAge(iso: string): string {
  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) return 'recently';

  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);

  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);

  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);

  return `${days}d ago`;
}
