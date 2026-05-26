import { App, Modal, Platform, Setting } from 'obsidian';

import type { PluginSettings } from '../types';

/**
 * Welcome modal — fires on truly fresh installs (no PAT secret, no
 * site URL, no repo owner; never on upgrade) and again whenever the
 * user re-opens it via "Forge: Show welcome guide" command.
 *
 * Design: ONE scrollable surface with three numbered cards + a "Test
 * everything" button + "Skip" link. No multi-screen state machine —
 * users can scroll, jump, dismiss freely.
 *
 * The modal does NOT save settings — it just guides users to the right
 * fields in the settings tab via "Open settings → Site" / "Open
 * settings → Storage" / "Open settings → Git" buttons. The actual data
 * entry happens in the full settings form, which already exists.
 *
 * The intent: turn a fresh install from "stare at empty form" into
 * "here are the 3 things to set, in this order, with a one-line
 * explanation of each".
 */
export class WelcomeModal extends Modal {
  constructor(
    app: App,
    private readonly settings: PluginSettings,
    private readonly callbacks: {
      openSettings: () => void;
      jumpTo: (which: 'site' | 'storage' | 'git') => void;
      runTestAll: () => Promise<void>;
      markDismissed: () => Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.addClass('forge-welcome-modal');

    contentEl.createEl('h2', { text: 'Welcome to Forge 👋' });
    contentEl.createEl('p', {
      text:
        'Forge publishes posts from your Obsidian vault to a static-site repo on GitHub. ' +
        "Here's the 3-minute setup. You can come back to this anytime via Settings → Forge.",
      cls: 'setting-item-description',
    });

    /* ---- Card 1: Site ---- */
    this.renderCard(contentEl, {
      step: 1,
      title: 'Where do your posts live?',
      body:
        'Your blog folder inside the vault (e.g. content/posts) and the live ' +
        "site URL where they'll be published (e.g. https://blog.example.com).",
      ctaLabel: 'Open Site settings →',
      onCta: () => {
        this.callbacks.openSettings();
        this.callbacks.jumpTo('site');
        this.close();
      },
    });

    /* ---- Card 2: Storage ---- */
    this.renderCard(contentEl, {
      step: 2,
      title: 'Where do attachments go?',
      body:
        'Images and other assets upload to S3-compatible storage (Cloudflare R2, ' +
        'AWS S3, MinIO, etc.) so the git repo stays small. Pick a provider ' +
        'preset; Forge prefills the right endpoint + region for you.',
      ctaLabel: 'Open Storage settings →',
      onCta: () => {
        this.callbacks.openSettings();
        this.callbacks.jumpTo('storage');
        this.close();
      },
    });

    /* ---- Card 3: Git ---- */
    this.renderCard(contentEl, {
      step: 3,
      title: 'Which repo?',
      body:
        'Your static-site repo on GitHub (e.g. you/blog) plus a Personal Access ' +
        "Token with `Contents: write` on that repo. Forge uses GitHub's web API " +
        'instead of `git push` so it works the same on desktop and iPhone.',
      ctaLabel: 'Open Git settings →',
      onCta: () => {
        this.callbacks.openSettings();
        this.callbacks.jumpTo('git');
        this.close();
      },
    });

    /* ---- Final: Test + Skip ---- */
    new Setting(contentEl)
      .setName('Once all three sections are filled in')
      .setDesc('Use Test all to verify before your first publish.')
      .addButton((b) =>
        b
          .setButtonText('Test all')
          .setCta()
          .onClick(async () => {
            await this.callbacks.runTestAll();
          }),
      )
      .addButton((b) =>
        b.setButtonText("Skip — I'll do it later").onClick(async () => {
          await this.callbacks.markDismissed();
          this.close();
        }),
      );

    /* ---- Mobile tip ---- */
    if (Platform.isMobile) {
      contentEl.createEl('p', {
        text:
          '📱 On iPhone/iPad: tap and hold an image in the editor to embed it, ' +
          'then publish — Forge uploads to S3 and rewrites the URL automatically.',
        cls: 'setting-item-description forge-welcome-mobile-tip',
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }

  private renderCard(
    parent: HTMLElement,
    opts: {
      step: number;
      title: string;
      body: string;
      ctaLabel: string;
      onCta: () => void;
    },
  ): void {
    const card = parent.createDiv({ cls: 'forge-welcome-card' });

    card.createEl('h3', { text: `${opts.step}. ${opts.title}` });
    card.createEl('p', { text: opts.body, cls: 'setting-item-description' });

    const btnEl = card.createEl('button', {
      text: opts.ctaLabel,
      cls: 'mod-cta',
    });

    btnEl.addEventListener('click', opts.onCta);
  }
}
