import { App, Modal, Platform, Setting } from 'obsidian';

import { detectHugoConfig, type HugoDetectResult } from '../util/hugo-config-detect';
import type { PluginSettings } from '../types';

/**
 * Welcome modal — info-only signpost shown once on fresh install.
 *
 * Design notes (this is the v0.5 simplification — the previous version
 * had three cards each with its own CTA, but any click closed the modal
 * which was confusing):
 *
 *   - ONE primary CTA: "Open Settings". Skip link next to it.
 *   - Three short bullets summarising what to configure. No per-bullet
 *     buttons.
 *   - If a Hugo config is detected at vault root, auto-fill the Site
 *     URL and announce it as a one-liner. No "use this?" button.
 *   - Mobile-platform hint shown as a small footer line.
 *
 * Modal can't be reopened from itself by design — once it closes, the
 * user is in the settings tab and the status badge at the top tells
 * them what's missing. Re-opening is via "Smithy: Show welcome guide"
 * command from the palette.
 */
export class WelcomeModal extends Modal {
  constructor(
    app: App,
    private readonly settings: PluginSettings,
    private readonly callbacks: {
      openSettings: () => void;
      markDismissed: () => Promise<void>;
      persistSettings: () => Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.addClass('smithy-welcome-modal');

    contentEl.createEl('h2', { text: 'Welcome to Smithy' });
    contentEl.createEl('p', {
      text:
        'Smithy publishes posts from this vault to your static-site repo on ' +
        'GitHub. Three sections in Settings to fill in:',
      cls: 'setting-item-description',
    });

    const list = contentEl.createEl('ul', { cls: 'smithy-welcome-list' });

    list.createEl('li', {
      text: 'Site — your posts folder + the live site URL',
    });
    list.createEl('li', {
      text: 'Storage — S3-compatible bucket for attachment uploads',
    });
    list.createEl('li', {
      text: "Git — repo Smithy commits to + your GitHub PAT",
    });

    // Detection one-liner (silent auto-apply). No interactive UI — the
    // user just sees that the field was prefilled and can adjust in
    // Settings if they want.
    void this.maybeApplyDetectedConfig(contentEl);

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Open Settings')
          .setCta()
          .onClick(async () => {
            await this.callbacks.markDismissed();
            this.callbacks.openSettings();
            this.close();
          }),
      )
      .addButton((b) =>
        b.setButtonText('Skip for now').onClick(async () => {
          await this.callbacks.markDismissed();
          this.close();
        }),
      );

    if (Platform.isMobile) {
      contentEl.createEl('p', {
        text:
          'On iPhone / iPad: same flow. The publish command lives in the ' +
          'Command palette; everything else is in Settings → Smithy.',
        cls: 'setting-item-description smithy-welcome-mobile-tip',
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }

  /**
   * If a Hugo config is detected and the Site fields are still empty,
   * silently fill them in and surface a one-line acknowledgement.
   *
   * No interactive UI — the welcome modal is info-only. Users who want
   * to override can do so directly in Settings; the status badge there
   * will reflect whatever's now configured.
   */
  private async maybeApplyDetectedConfig(parent: HTMLElement): Promise<void> {
    let result: HugoDetectResult | null;

    try {
      result = await detectHugoConfig(this.app);
    } catch {
      return;
    }

    if (!result) return;

    const applied: string[] = [];

    if (result.baseUrl && !this.settings.site.siteBaseUrl) {
      this.settings.site.siteBaseUrl = result.baseUrl;
      applied.push(`Site URL → ${result.baseUrl}`);
    }
    if (result.postsFolderExists && !this.settings.site.postsFolder) {
      this.settings.site.postsFolder = 'content/posts';
      applied.push('Posts folder → content/posts');
    }

    if (applied.length === 0) return;

    await this.callbacks.persistSettings();

    const note = parent.createEl('p', {
      cls: 'setting-item-description smithy-welcome-detected',
    });

    note.createEl('strong', {
      text: `Detected ${result.configPath}  `,
    });
    note.createSpan({ text: '— filled in: ' + applied.join(', ') });
  }
}
