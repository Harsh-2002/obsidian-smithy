import { Notice, Plugin } from 'obsidian';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { hasSecretStorageRuntime } from './secrets';
import { StaticPublisherSettingTab } from './ui/settings-tab';
import type { PluginSettings } from './types';

/**
 * static-publisher — minimal CMS inside Obsidian for Hugo blogs.
 *
 * Lifecycle layout:
 *   onload()              ← keep < 5ms: register commands, settings tab,
 *                           schedule deferred init
 *   onLayoutReady()       ← load settings, runtime feature-detect, flip
 *                           `ready` so command callbacks activate
 *   onunload()            ← registerEvent / registerInterval auto-clean;
 *                           no persistent state to tear down
 */
export default class StaticPublisher extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  /** `true` after deferred init finishes. Commands gate on this. */
  private ready = false;

  async onload() {
    // Settings tab — visible immediately so the user can configure even
    // before settings load (it operates on the in-memory DEFAULT_SETTINGS
    // until deferredInit replaces them).
    this.addSettingTab(new StaticPublisherSettingTab(this.app, this, this));

    // Commands registered now; their callbacks early-out until `ready`.
    this.addCommand({
      id: 'publish-current-post',
      name: 'Publish current post',
      checkCallback: (checking) => {
        if (!this.ready) return false;

        const file = this.app.workspace.getActiveFile();

        if (!file) return false;
        if (!file.path.startsWith(this.settings.site.postsFolder + '/')) {
          return false;
        }

        if (!checking) {
          // P12 replaces this stub with the real pipeline invocation +
          // PublishModal. For now: friendly notice.
          new Notice(
            'Publish pipeline wires into this command in P12. ' +
              'Settings + tests are usable now.',
          );
        }

        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.deferredInit();
    });
  }

  async onunload() {
    // No manual teardown — registerEvent / registerInterval / registerDomEvent
    // are auto-cleaned; we don't hold any persistent sockets or timers.
  }

  /** Heavy work after the workspace is ready. */
  private async deferredInit() {
    this.settings = await loadSettings(this);

    if (!hasSecretStorageRuntime(this.app)) {
      // eslint-disable-next-line no-console
      console.warn(
        '[static-publisher] app.secretStorage not available; ' +
          'falling back to vault-scoped localStorage. ' +
          'Upgrade Obsidian to 1.5+ for the proper API.',
      );
    }

    this.ready = true;
  }

  /** Called by the settings tab when any field changes. */
  async persist() {
    await saveSettings(this, this.settings);
  }
}
