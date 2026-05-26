import { Notice, Plugin } from 'obsidian';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { hasSecretStorageRuntime } from './secrets';
import type { PluginSettings } from './types';

/**
 * firstfinger-publisher — minimal CMS inside Obsidian for Hugo blogs.
 *
 * Lifecycle layout:
 *
 *   onload()              ← keep < 5ms: only register commands, settings tab
 *   onLayoutReady()       ← load settings, warm provider preset, activate
 *                           commands (settings now available)
 *   onunload()            ← registerEvent/registerInterval auto-clean; no
 *                           manual teardown needed in v0.1.0
 */
export default class FirstfingerPublisher extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  /**
   * `true` after onLayoutReady has loaded settings. Commands check this and
   * politely refuse if invoked too early.
   */
  private ready = false;

  async onload() {
    // Register commands eagerly so they appear in the palette right away.
    // Their callbacks no-op until `ready` flips true.
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
          // Pipeline lands in P9; for now this is a friendly stub.
          new Notice('firstfinger-publisher: publish pipeline lands in P9');
        }

        return true;
      },
    });

    // Settings tab lands in P10. Registered here so an empty placeholder
    // shows up in Settings → Community plugins while we build out the form.
    // (Will be replaced with real UI in P10.)

    // Defer everything else.
    this.app.workspace.onLayoutReady(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.deferredInit();
    });
  }

  async onunload() {
    // No manual cleanup — registerEvent / registerInterval / registerDomEvent
    // are auto-cleaned, and we don't open any persistent network sockets.
  }

  /**
   * Heavy work deferred until after the workspace is ready. Anything that
   * touches the vault, reads settings, or hits the network goes here.
   */
  private async deferredInit() {
    this.settings = await loadSettings(this);

    if (!hasSecretStorageRuntime(this.app)) {
      // Not fatal — the secrets module falls back to vault-scoped
      // localStorage. Worth surfacing once so the user knows their runtime
      // is older than the recommended API.
      // eslint-disable-next-line no-console
      console.warn(
        '[firstfinger-publisher] app.secretStorage not available; using ' +
          'localStorage fallback. Update Obsidian to 1.5+ for the proper API.',
      );
    }

    this.ready = true;
  }

  /** Persist current settings. Called from the settings tab in P10. */
  async persist() {
    await saveSettings(this, this.settings);
  }
}
