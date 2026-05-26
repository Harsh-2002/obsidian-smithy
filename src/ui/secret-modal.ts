import { App, Modal, Setting } from 'obsidian';

import { setSecret, getSecret } from '../secrets';

/**
 * Modal for entering or replacing a secret value (S3 secret key,
 * GitHub PAT, etc.) — the only place the actual secret string is
 * accepted from the user. The settings UI shows only the secret's
 * NAME (so data.json never contains a secret).
 *
 * Why a modal: a single Setting().addText() row would either show the
 * stored value (leak risk if someone screenshots the settings page) or
 * always show empty (confusing — "is it set?"). A modal:
 *   - shows "(value is set)" / "(not set)" status separately
 *   - on submit, writes through to secretStorage
 *   - clears the input on close
 */

export class SecretModal extends Modal {
  private inputValue = '';
  private statusText = '';

  constructor(
    app: App,
    private readonly secretName: string,
    private readonly label: string,
    private readonly hint?: string,
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: this.label });
    if (this.hint) {
      contentEl.createEl('p', { text: this.hint, cls: 'setting-item-description' });
    }
    contentEl.createEl('p', {
      text: `Secret name: ${this.secretName}`,
      cls: 'setting-item-description',
    });

    const existing = await getSecret(this.app, this.secretName);

    this.statusText = existing
      ? '✓ A value is currently stored. Enter a new value to replace.'
      : '⚠ No value is currently stored.';

    const status = contentEl.createEl('p', {
      text: this.statusText,
      cls: 'setting-item-description',
    });

    void status; // referenced for the read

    new Setting(contentEl)
      .setName('Value')
      .setDesc('The secret value itself. Stored in vault-scoped local storage, not data.json.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder('paste secret here');
        text.onChange((v) => {
          this.inputValue = v;
        });
        // Focus on open
        setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Save')
          .setCta()
          .onClick(async () => {
            if (!this.inputValue) {
              return;
            }
            await setSecret(this.app, this.secretName, this.inputValue);
            this.inputValue = '';
            this.close();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => {
          this.inputValue = '';
          this.close();
        }),
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
