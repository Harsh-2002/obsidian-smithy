import { App, Modal, Notice, Setting } from 'obsidian';

import { getSecret } from '../secrets';
import { publicUrlFor, S3Client } from '../storage/s3-client';
import { renderKey } from '../storage/path-template';
import { mimeFromFilename } from '../util/mime';
import type { PluginSettings } from '../types';

/**
 * "Upload single attachment" — ad-hoc one-off upload.
 *
 *   - Opens a native file picker.
 *   - Uploads the chosen file to S3 with the configured path template.
 *   - Copies the resulting CDN URL to the clipboard.
 *
 * Useful when you want to share an asset URL without committing it to
 * any specific post (e.g. embedding in a social-media reply).
 */
export async function uploadSingleAttachment(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  return new Promise((resolve) => {
    const modal = new UploadSingleModal(app, settings, () => resolve());

    modal.open();
  });
}

class UploadSingleModal extends Modal {
  private file: File | null = null;

  constructor(
    app: App,
    private readonly settings: PluginSettings,
    private readonly onDone: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: 'Upload single attachment' });
    contentEl.createEl('p', {
      text:
        'Pick a file from your device. It will be uploaded with the ' +
        'configured path template, and the public URL will land on your ' +
        'clipboard.',
      cls: 'setting-item-description',
    });

    const fileInput = contentEl.createEl('input', {
      type: 'file',
      attr: { style: 'margin: 8px 0;' },
    });

    fileInput.addEventListener('change', () => {
      this.file = fileInput.files?.[0] ?? null;
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Upload')
          .setCta()
          .onClick(async () => {
            if (!this.file) {
              new Notice('Pick a file first');
              return;
            }
            await this.doUpload(this.file);
            this.close();
            this.onDone();
          }),
      )
      .addButton((b) =>
        b.setButtonText('Cancel').onClick(() => {
          this.close();
          this.onDone();
        }),
      );
  }

  onClose() {
    this.contentEl.empty();
  }

  private async doUpload(file: File): Promise<void> {
    try {
      const accessKeyId = await getSecret(
        this.app,
        this.settings.storage.accessKeyIdSecret,
      );
      const secretAccessKey = await getSecret(
        this.app,
        this.settings.storage.secretAccessKeySecret,
      );

      if (!accessKeyId || !secretAccessKey) {
        new Notice('S3 credentials not set — open settings → Storage');
        return;
      }

      const bytes = await file.arrayBuffer();
      const key = await renderKey(this.settings.storage.pathTemplate, {
        date: new Date(),
        slug: '_loose',
        filename: file.name,
        bytes,
      });

      const client = new S3Client(this.settings.storage, {
        accessKeyId,
        secretAccessKey,
      });

      await client.putObject(key, bytes, mimeFromFilename(file.name));
      const url = publicUrlFor(this.settings.storage.publicUrlBase, key);

      try {
        await navigator.clipboard.writeText(url);
        new Notice(`Uploaded ✓ URL copied: ${url}`, 8000);
      } catch {
        new Notice(`Uploaded ✓ ${url}`, 12000);
      }
    } catch (e) {
      new Notice(
        `Upload failed: ${e instanceof Error ? e.message : String(e)}`,
        12000,
      );
    }
  }
}
