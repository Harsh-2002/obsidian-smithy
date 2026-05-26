import { Editor, MarkdownView, Notice, Plugin } from 'obsidian';

import { dryRunCommand } from './commands/dry-run';
import { newPostCommand } from './commands/new-post';
import { openShortcodePicker } from './commands/insert-shortcode';
import {
  canOpenPublished,
  openPublishedCommand,
} from './commands/open-published';
import { publishCurrentCommand } from './commands/publish-current';
import { uploadSingleAttachment } from './commands/upload-single';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { hasSecretStorageRuntime } from './secrets';
import { ForgeSettingTab } from './ui/settings-tab';
import { StatusBarChip } from './ui/status-bar';
import type { PluginSettings } from './types';

/**
 * Forge — publish posts from your Obsidian vault to a static-site repo
 * on GitHub, with S3-compatible attachment uploads.
 *
 * Lifecycle:
 *   onload()              ← keep fast (< 5ms target): register commands +
 *                           settings tab, schedule deferred init
 *   onLayoutReady()       ← load settings, mount status-bar chip, flip
 *                           `ready` flag so command callbacks activate
 *   onunload()            ← Plugin auto-cleans registerEvent /
 *                           registerInterval / addStatusBarItem
 */
export default class Forge extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  /** Flipped true once deferred init has loaded settings. */
  private ready = false;

  /** Status-bar chip — created during deferred init. */
  private chip: StatusBarChip | null = null;

  async onload() {
    this.addSettingTab(new ForgeSettingTab(this.app, this, this));

    /* ===== Publish current post (Mod+Shift+P default hotkey) ===== */
    this.addCommand({
      id: 'publish-current-post',
      name: 'Publish current post',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'P' }],
      checkCallback: (checking) => {
        if (!this.ready) return false;

        const file = this.app.workspace.getActiveFile();

        if (!file) return false;

        const postsRoot = this.settings.site.postsFolder.replace(/\/+$/, '');

        if (!file.path.startsWith(postsRoot + '/')) {
          return false;
        }

        if (!checking) {
          publishCurrentCommand(this.app, this.settings, this.chip);
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

    /* ===== Open published version ===== */
    this.addCommand({
      id: 'open-published-version',
      name: 'Open published version',
      checkCallback: (checking) => {
        if (!this.ready) return false;
        if (!canOpenPublished(this.app, this.settings)) return false;
        if (!checking) openPublishedCommand(this.app, this.settings);
        return true;
      },
    });

    /* ===== Dry-run publish ===== */
    this.addCommand({
      id: 'dry-run-publish-current-post',
      name: 'Dry-run publish current post',
      checkCallback: (checking) => {
        if (!this.ready) return false;

        const file = this.app.workspace.getActiveFile();

        if (!file) return false;
        const postsRoot = this.settings.site.postsFolder.replace(/\/+$/, '');

        if (!file.path.startsWith(postsRoot + '/')) return false;
        if (!checking) dryRunCommand(this.app, this.settings);
        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => {
      this.deferredInit();
    });
  }

  async onunload() {
    this.chip?.destroy();
    this.chip = null;
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

    // Mount the status-bar chip — visible everywhere, hides itself when
    // the active file isn't a post.
    const chipEl = this.addStatusBarItem();

    this.chip = new StatusBarChip(this.app, chipEl, {
      settings: this.settings,
      onChipClick: () => {
        // Ignore clicks during an active publish — chip is the progress UI.
        if (this.chip?.isPublishing()) return;
        // If there are open lint warnings, prioritize showing them so the
        // user has context before publishing.
        if (this.chip && this.chip.hasLintIssues()) {
          this.chip.showLintDetail();
          return;
        }
        // @ts-expect-error — app.commands isn't in Obsidian's public types
        this.app.commands.executeCommandById('forge:publish-current-post');
      },
    });

    this.ready = true;
  }

  /** Called by the settings tab on any field change. */
  async persist() {
    await saveSettings(this, this.settings);
  }
}
