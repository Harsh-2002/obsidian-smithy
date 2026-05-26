import { App, Modal, Notice, Setting, TFile } from 'obsidian';

import { getSecret } from '../secrets';
import { publicUrlFor, S3Client } from '../storage/s3-client';
import { renderKey } from '../storage/path-template';
import { mimeFromFilename } from '../util/mime';
import { setFrontmatterKey } from '../util/frontmatter-update';
import { slugFromPostPath } from '../engine';
import type { PluginSettings } from '../types';

/**
 * "Set cover image" command — one-shot:
 *   1. Native file picker
 *   2. Upload to S3 with the configured path template (slug = post slug)
 *   3. Write `cover = "<cdn-url>"` into the active post's frontmatter
 *
 * Removes the friction of: upload separately → copy URL → switch file →
 * find frontmatter → paste. The cover is set in two clicks.
 */

export function canSetCover(app: App, settings: PluginSettings): boolean {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) return false;
  const postsRoot = settings.site.postsFolder.replace(/\/+$/, '');

  return file.path.startsWith(postsRoot + '/');
}

export async function setCoverImageCommand(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) {
    new Notice('No active file');
    return;
  }

  new SetCoverModal(app, settings, file).open();
}

class SetCoverModal extends Modal {
  private chosen: File | null = null;

  constructor(
    app: App,
    private readonly settings: PluginSettings,
    private readonly post: TFile,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: 'Set cover image' });
    contentEl.createEl('p', {
      text:
        `Pick an image. It will upload to your CDN and the cover URL will be written ` +
        `into the frontmatter of "${this.post.basename}".`,
      cls: 'setting-item-description',
    });

    const fileInput = contentEl.createEl('input', {
      type: 'file',
      attr: { accept: 'image/*', style: 'margin: 12px 0;' },
    });

    fileInput.addEventListener('change', () => {
      this.chosen = fileInput.files?.[0] ?? null;
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Upload + set cover')
          .setCta()
          .onClick(async () => {
            if (!this.chosen) {
              new Notice('Pick an image file first');
              return;
            }
            await this.run(this.chosen);
            this.close();
          }),
      )
      .addButton((b) =>
        b.setButtonText('Cancel').onClick(() => this.close()),
      );
  }

  onClose() {
    this.contentEl.empty();
  }

  private async run(file: File): Promise<void> {
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
        new Notice('S3 credentials not set — open Settings → Forge → Storage');
        return;
      }

      const bytes = await file.arrayBuffer();
      const slug = slugFromPostPath(this.post.path, this.settings.site.postsFolder);
      const key = await renderKey(this.settings.storage.pathTemplate, {
        date: new Date(),
        slug,
        filename: file.name,
        bytes,
      });

      const client = new S3Client(this.settings.storage, {
        accessKeyId,
        secretAccessKey,
      });

      await client.putObject(key, bytes, mimeFromFilename(file.name));
      const url = publicUrlFor(this.settings.storage.publicUrlBase, key);

      await setFrontmatterKey(this.app, this.post, 'cover', url);

      new Notice(`Cover set ✓\n${url}`, 8000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      new Notice(`Set cover failed: ${msg}`, 12000);
    }
  }
}
