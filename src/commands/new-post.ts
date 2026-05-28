import { App, Modal, Notice, Setting, TFolder } from 'obsidian';

import { getEngine } from '../engine';
import { slugify } from '../util/slug';
import type { PluginSettings } from '../types';

/**
 * "New post" command — prompts for a title, slugifies it, creates
 *   <postsFolder>/<slug>/index.md
 * with the engine's frontmatter template, then opens it.
 *
 * The folder is created if it doesn't exist. If a post with that slug
 * already exists, the dialog refuses to overwrite.
 */

export async function newPostCommand(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  return new Promise((resolve) => {
    const modal = new NewPostModal(app, settings, () => resolve());

    modal.open();
  });
}

class NewPostModal extends Modal {
  private title = '';

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
    contentEl.createEl('h2', { text: 'New post' });

    new Setting(contentEl).setName('Title').addText((t) => {
      t.setPlaceholder('Fixing xterm-ghostty on macOS')
        .onChange((v) => {
          this.title = v;
        });
      setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Create')
          .setCta()
          .onClick(async () => {
            await this.createPost();
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

  private async createPost(): Promise<void> {
    if (!this.title.trim()) {
      new Notice('Title is required');
      return;
    }

    const slug = slugify(this.title);
    const postsRoot = this.settings.site.postsFolder.replace(/\/+$/, '');
    const folder = `${postsRoot}/${slug}`;
    const file = `${folder}/index.md`;

    // Ensure parent folder exists.
    if (!(this.app.vault.getAbstractFileByPath(postsRoot) instanceof TFolder)) {
      try {
        await this.app.vault.createFolder(postsRoot);
      } catch {
        // Race-tolerant: another concurrent create can have made it.
      }
    }

    if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        // Same
      }
    }

    if (this.app.vault.getAbstractFileByPath(file)) {
      new Notice(`Post already exists at ${file}`);
      return;
    }

    const engine = getEngine(this.settings.site.engine);
    const body = engine.scaffoldPost({
      title: this.title.trim(),
      date: new Date(),
      draft: this.settings.site.newPostsAreDrafts,
      format: this.settings.site.frontmatterFormat,
    });

    const created = await this.app.vault.create(file, body);

    await this.app.workspace.getLeaf(false).openFile(created);
    new Notice(`Created ${file}`);
  }
}
