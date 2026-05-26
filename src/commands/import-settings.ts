import { App, Modal, Notice, Setting, TFile } from 'obsidian';

import { setSecret } from '../secrets';
import type { PluginSettings } from '../types';

/**
 * "Smithy: Import settings" — read a `smithy-config.json` from the vault
 * and apply it.
 *
 * Plain JSON only (matches the simpler export flow). If your config
 * is encrypted (older versions), re-export from the source device
 * with the current plugin.
 *
 * Path is editable in the modal but defaults to `smithy-config.json`
 * at vault root — same default as the export command.
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
  exportedAt?: string;
  pluginVersion?: string;
  settings: {
    site: PluginSettings['site'];
    storage: PluginSettings['storage'];
    git: PluginSettings['git'];
    autoRenameScreenshots?: boolean;
  };
  secrets: Record<string, string>;
}

class ImportModal extends Modal {
  private inputPath = 'smithy-config.json';

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
    contentEl.createEl('h2', { text: 'Import Smithy settings' });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text:
        'Loads a smithy-config.json from your vault and applies it to ' +
        'this device. Includes settings + the 3 secrets (PAT, S3 keys).',
    });

    new Setting(contentEl)
      .setName('File path inside vault')
      .addText((t) =>
        t.setValue(this.inputPath).onChange((v) => {
          this.inputPath = v.trim();
        }),
      );

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
    if (!this.inputPath) {
      new Notice('Pick a file path');
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

      payload = JSON.parse(raw) as ExportPayload;
    } catch (e) {
      new Notice(
        `Could not parse ${this.inputPath} — is it a Smithy config JSON?`,
        10000,
      );
      console.warn('[smithy] import parse error', e);

      return;
    }

    if (!payload.schema || !payload.schema.startsWith('smithy-export.')) {
      new Notice('File is not a Smithy settings export');
      return;
    }
    if (!payload.settings || !payload.secrets) {
      new Notice('Config file is missing required fields');
      return;
    }

    try {
      // Preserve per-vault state — publishHistory + welcomeModalDismissed
      // should NEVER ride the import. Everything else comes from the file.
      const merged: PluginSettings = {
        settingsVersion: this.currentSettings.settingsVersion,
        site: payload.settings.site,
        storage: payload.settings.storage,
        git: payload.settings.git,
        autoRenameScreenshots: !!payload.settings.autoRenameScreenshots,
        publishHistory: this.currentSettings.publishHistory,
        welcomeModalDismissed: true,
      };

      await this.applySettings(merged);

      // Write each bundled secret under its NAME (same name the export
      // recorded). If the user changed secret names locally before
      // importing, the names from the file take precedence — settings
      // above already updated to the file's names anyway.
      for (const [name, value] of Object.entries(payload.secrets)) {
        if (typeof value === 'string' && value.length > 0) {
          await setSecret(this.app, name, value);
        }
      }

      new Notice(
        `Imported ✓ from ${this.inputPath}. ` +
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
