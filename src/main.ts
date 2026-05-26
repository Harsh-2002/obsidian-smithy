import { Editor, MarkdownView, Notice, Plugin } from 'obsidian';

import { newPostCommand } from './commands/new-post';
import { openShortcodePicker } from './commands/insert-shortcode';
import { publishCurrentCommand } from './commands/publish-current';
import { uploadSingleAttachment } from './commands/upload-single';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { hasSecretStorageRuntime } from './secrets';
import { ForgeSettingTab } from './ui/settings-tab';
import type { PluginSettings } from './types';

/**
 * Forge — publish posts from your Obsidian vault to a
 * static-site repo on GitHub, with S3-compatible attachment uploads.
 *
 * Lifecycle:
 *   onload()              ← keep fast (< 5ms target): register commands +
 *                           settings tab, schedule deferred init
 *   onLayoutReady()       ← load settings, runtime feature-detect, flip
 *                           `ready` flag so command callbacks activate
 *   onunload()            ← registerEvent / registerInterval / etc.
 *                           auto-clean; no persistent state to tear down
 */
export default class Forge extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  /** Flipped true once deferred init has loaded settings. */
  private ready = false;

  async onload() {
    this.addSettingTab(new ForgeSettingTab(this.app, this, this));

    /* ===== Publish current post ===== */
    this.addCommand({
      id: 'publish-current-post',
      name: 'Publish current post',
      checkCallback: (checking) => {
        if (!this.ready) return false;

        const file = this.app.workspace.getActiveFile();

        if (!file) return false;

        const postsRoot = this.settings.site.postsFolder.replace(/\/+$/, '');

        if (!file.path.startsWith(postsRoot + '/')) {
          return false;
        }

        if (!checking) {
           
          publishCurrentCommand(this.app, this.settings);
        }

        return true;
      },
    });

    /* ===== Insert Hugo shortcode ===== */
    this.addCommand({
      id: 'insert-hugo-shortcode',
      name: 'Insert Hugo shortcode',
      editorCallback: (editor: Editor, _view: MarkdownView) => {
        if (!this.ready) {
          new Notice('Plugin still initializing — try again in a second');
          return;
        }
        openShortcodePicker(this.app, editor);
      },
    });

    /* ===== New post ===== */
    this.addCommand({
      id: 'new-post',
      name: 'New post',
      callback: () => {
        if (!this.ready) {
          new Notice('Plugin still initializing — try again in a second');
          return;
        }
         
        newPostCommand(this.app, this.settings);
      },
    });

    /* ===== Upload single attachment ===== */
    this.addCommand({
      id: 'upload-single-attachment',
      name: 'Upload single attachment to S3',
      callback: () => {
        if (!this.ready) {
          new Notice('Plugin still initializing — try again in a second');
          return;
        }
         
        uploadSingleAttachment(this.app, this.settings);
      },
    });

    this.app.workspace.onLayoutReady(() => {
       
      this.deferredInit();
    });
  }

  async onunload() {
    // No persistent sockets/timers; registerEvent + Plugin auto-clean handle
    // everything else.
  }

  private async deferredInit() {
    this.settings = await loadSettings(this);

    if (!hasSecretStorageRuntime(this.app)) {
       
      console.warn(
        '[forge] app.secretStorage not available; ' +
          'using vault-scoped localStorage as a fallback. ' +
          'Update Obsidian to 1.5+ for the proper API.',
      );
    }

    this.ready = true;
  }

  /** Called by the settings tab on any field change. */
  async persist() {
    await saveSettings(this, this.settings);
  }
}
