import { Editor, MarkdownView, Notice, Plugin } from 'obsidian';

import { dryRunCommand } from './commands/dry-run';
import { newPostCommand } from './commands/new-post';
import { openShortcodePicker } from './commands/insert-shortcode';
import {
  canOpenPublished,
  openPublishedCommand,
} from './commands/open-published';
import { canSetCover, setCoverImageCommand } from './commands/set-cover';
import { publishAllDraftsCommand } from './commands/publish-all-drafts';
import { publishCurrentCommand } from './commands/publish-current';
import { undoLastPublishCommand, canUndoPublish } from './commands/undo-publish';
import { uploadSingleAttachment } from './commands/upload-single';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { hasSecretStorageRuntime } from './secrets';
import { ForgeSettingTab } from './ui/settings-tab';
import { StatusBarChip } from './ui/status-bar';
import { WelcomeModal } from './ui/welcome-modal';
import { isFreshInstall } from './util/check-configured';
import { attachPasteRenameListener } from './util/pasted-image-rename';
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
          publishCurrentCommand(
            this.app,
            this.settings,
            this.chip,
            () => this.persist(),
          );
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

    /* ===== Set cover image =====
     * One-shot: pick file → upload → write frontmatter `cover` field.
     * Use when the image isn't yet in the post folder; otherwise just
     * reference `cover = "myfile.png"` and publish handles it. */
    this.addCommand({
      id: 'set-cover-image',
      name: 'Set cover image',
      checkCallback: (checking) => {
        if (!this.ready) return false;
        if (!canSetCover(this.app, this.settings)) return false;
        if (!checking) setCoverImageCommand(this.app, this.settings);
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

    /* ===== Undo last publish ===== */
    this.addCommand({
      id: 'undo-last-publish',
      name: 'Undo last publish',
      checkCallback: (checking) => {
        if (!this.ready) return false;
        if (!canUndoPublish(this.app, this.settings)) return false;
        if (!checking) {
          undoLastPublishCommand(this.app, this.settings, () => this.persist());
        }
        return true;
      },
    });

    /* ===== Publish all drafts ===== */
    this.addCommand({
      id: 'publish-all-drafts',
      name: 'Publish all drafts',
      callback: () => {
        if (!this.ready) {
          new Notice('Plugin still initializing — try again in a second');
          return;
        }
        publishAllDraftsCommand(this.app, this.settings, () => this.persist());
      },
    });

    /* ===== Show frontmatter lint details =====
     * The chip's ⚠ N badge already signals the count; this command lets
     * the user open the per-issue detail without clicking the chip
     * (which now always publishes). */
    this.addCommand({
      id: 'show-lint-details',
      name: 'Show frontmatter lint details',
      callback: () => {
        if (!this.ready) return;
        this.chip?.showLintDetail();
      },
    });

    /* ===== Show welcome guide =====
     * Always-available — even after first-run dismiss, users can pull
     * the modal back up for the 3-step setup overview. */
    this.addCommand({
      id: 'show-welcome-guide',
      name: 'Show welcome guide',
      callback: () => {
        if (!this.ready) return;
        this.openWelcomeModal();
      },
    });

    this.app.workspace.onLayoutReady(() => {
      this.deferredInit();
    });
  }

  async onunload() {
    this.chip?.destroy();
    this.chip = null;
    this.pasteDetach?.();
    this.pasteDetach = null;
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
        // Always publish on click. Lint warnings surface in the publish
        // modal (non-blocking) and via the ⚠ N badge on the chip. There's
        // a separate command "Forge: show lint details" for inspecting
        // warnings without publishing.
        // @ts-expect-error — app.commands isn't in Obsidian's public types
        this.app.commands.executeCommandById('forge:publish-current-post');
      },
    });

    // Auto-rename listener for pasted screenshots inside the posts folder.
    // No-op when the user has the toggle OFF (default) or when Custom
    // Attachment Location is detected.
    this.pasteDetach = attachPasteRenameListener({
      app: this.app,
      settings: this.settings,
    });

    this.ready = true;

    // Fire the welcome modal on truly fresh installs. Conservative
    // gate: only when owner + siteBaseUrl are empty AND no PAT secret
    // exists AND user hasn't already dismissed. Existing v0.4 users
    // never see this on upgrade.
    if (await isFreshInstall(this.app, this.settings)) {
      this.openWelcomeModal();
    }
  }

  /** Open the welcome modal — wired to the on-load fresh-install gate
   * and the "Show welcome guide" command. */
  private openWelcomeModal(): void {
    new WelcomeModal(this.app, this.settings, {
      openSettings: () => {
        // @ts-expect-error — Obsidian's setting object isn't in public types
        this.app.setting.open();
        // @ts-expect-error — same
        this.app.setting.openTabById('forge');
      },
      jumpTo: (which) => {
        // The settings tab handles scroll-to-section via a class hook.
        // We defer to next tick so the tab DOM exists when we query.
        setTimeout(() => {
          const el = document.querySelector(`.forge-section-${which}`);

          if (el instanceof HTMLElement) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      },
      runTestAll: async () => {
        // Best-effort: open settings so the user sees the Notice fire
        // there alongside the existing Test all button. Not strictly
        // required — the Notice toast fires globally.
        // @ts-expect-error — app.setting not in Obsidian's public types
        this.app.setting.open();
        // @ts-expect-error — app.setting not in Obsidian's public types
        this.app.setting.openTabById('forge');
      },
      markDismissed: async () => {
        this.settings.welcomeModalDismissed = true;
        await this.persist();
      },
    }).open();
  }

  /** Disposer for the paste-rename vault listener. */
  private pasteDetach: (() => void) | null = null;

  /** Called by the settings tab on any field change. */
  async persist() {
    await saveSettings(this, this.settings);
  }
}
