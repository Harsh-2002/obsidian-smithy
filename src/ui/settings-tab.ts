import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { Plugin } from 'obsidian';

import { applyPreset, PROVIDER_PRESETS } from '../storage/presets';
import { getSecret } from '../secrets';
import { publicUrlFor, S3Client } from '../storage/s3-client';
import { renderKey } from '../storage/path-template';
import { testAccess } from '../git/github-rest';
import type { PluginSettings, ProviderPresetId } from '../types';

import { SecretModal } from './secret-modal';

/**
 * Settings tab — three top-level sections (Site, Storage, Git) shown on
 * one scrolling page. Vanilla Obsidian Setting / setHeading idioms, no
 * tabs (Obsidian's API doesn't expose tabs natively).
 *
 * Provider preset dropdown auto-fills endpoint / region / forcePathStyle
 * when changed; every field stays editable. "Test upload" PUTs a 4-byte
 * blob; "Test token" hits GET /repos/{o}/{r}. Both report inline via
 * Notice.
 *
 * Secrets are managed via a separate modal (see SecretModal) — settings
 * never store the secret VALUES, only NAMES. The modal writes through to
 * app.secretStorage (or the localStorage fallback).
 */

export interface SettingsTabHost {
  settings: PluginSettings;
  persist(): Promise<void>;
}

export class FirstfingerSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: SettingsTabHost,
    plugin: Plugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: 'Firstfinger Publisher' });
    containerEl.createEl('p', {
      text:
        'One-command publish for Hugo blogs. Configure your S3-compatible ' +
        'storage and GitHub repo below, then use the "Publish current post" ' +
        'command from inside a post.',
      cls: 'setting-item-description',
    });

    this.renderSiteSection(containerEl);
    this.renderStorageSection(containerEl);
    this.renderGitSection(containerEl);
  }

  /* ===== Site ===== */

  private renderSiteSection(c: HTMLElement) {
    new Setting(c).setName('Site').setHeading();

    new Setting(c)
      .setName('Posts folder')
      .setDesc(
        'Vault-relative folder holding your blog posts as page bundles ' +
          '(e.g. content/posts). Only files inside this folder are eligible ' +
          'for "Publish current post".',
      )
      .addText((t) =>
        t
          .setPlaceholder('content/posts')
          .setValue(this.host.settings.site.postsFolder)
          .onChange(async (v) => {
            this.host.settings.site.postsFolder = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Site base URL')
      .setDesc(
        'The public URL of your live site (e.g. https://blog.firstfinger.io). ' +
          'Used to build "View live post" links after publish.',
      )
      .addText((t) =>
        t
          .setPlaceholder('https://blog.example.com')
          .setValue(this.host.settings.site.siteBaseUrl)
          .onChange(async (v) => {
            this.host.settings.site.siteBaseUrl = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('New posts as drafts')
      .setDesc('When using "New post", set draft = true in the frontmatter.')
      .addToggle((tog) =>
        tog
          .setValue(this.host.settings.site.newPostsAreDrafts)
          .onChange(async (v) => {
            this.host.settings.site.newPostsAreDrafts = v;
            await this.host.persist();
          }),
      );
  }

  /* ===== Storage ===== */

  private renderStorageSection(c: HTMLElement) {
    new Setting(c).setName('Storage').setHeading();

    new Setting(c)
      .setName('Provider')
      .setDesc(
        'S3-compatible storage provider. Selecting a preset pre-fills the ' +
          'endpoint, region, and path style — every field stays editable.',
      )
      .addDropdown((dd) => {
        for (const p of Object.values(PROVIDER_PRESETS)) {
          dd.addOption(p.id, p.label);
        }
        dd.setValue(this.host.settings.storage.preset).onChange(async (v) => {
          const preset = v as ProviderPresetId;

          this.host.settings.storage = applyPreset(
            this.host.settings.storage,
            preset,
          );
          await this.host.persist();
          this.display(); // re-render so endpoint/region fields refresh
        });
      });

    const presetNote =
      PROVIDER_PRESETS[this.host.settings.storage.preset]?.note;

    if (presetNote) {
      c.createEl('div', {
        text: presetNote,
        cls: 'setting-item-description',
        attr: { style: 'margin-top: -8px; margin-bottom: 12px;' },
      });
    }

    new Setting(c)
      .setName('Bucket')
      .setDesc('Name of the bucket where attachments will be uploaded.')
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.bucket)
          .onChange(async (v) => {
            this.host.settings.storage.bucket = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Endpoint')
      .setDesc(
        'S3 API endpoint. Placeholders like {account_id} / {region} should ' +
          'be replaced with your actual values.',
      )
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.endpoint)
          .onChange(async (v) => {
            this.host.settings.storage.endpoint = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Region')
      .setDesc('Region for SigV4 signing. R2 uses "auto"; AWS uses e.g. us-east-1.')
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.region)
          .onChange(async (v) => {
            this.host.settings.storage.region = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Force path-style addressing')
      .setDesc('Required for MinIO and some custom S3-compatible servers.')
      .addToggle((tog) =>
        tog
          .setValue(this.host.settings.storage.forcePathStyle)
          .onChange(async (v) => {
            this.host.settings.storage.forcePathStyle = v;
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Public URL base')
      .setDesc(
        'CDN domain that serves the bucket (e.g. https://cdn.example.com). ' +
          'All uploaded files are referenced relative to this URL.',
      )
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.publicUrlBase)
          .onChange(async (v) => {
            this.host.settings.storage.publicUrlBase = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Path template')
      .setDesc(
        'S3 object key template. Tokens: {year} {month} {day} {slug} ' +
          '{filename} {ext} {hash}. Default groups uploads by post + month.',
      )
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.pathTemplate)
          .onChange(async (v) => {
            this.host.settings.storage.pathTemplate = v;
            await this.host.persist();
          }),
      );

    /* --- Secrets --- */

    new Setting(c)
      .setName('Access key ID (secret name)')
      .setDesc(
        'Name used in secretStorage. The actual value is set via the ' +
          '"Set value" button — never typed into this field.',
      )
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.accessKeyIdSecret)
          .onChange(async (v) => {
            this.host.settings.storage.accessKeyIdSecret = v.trim();
            await this.host.persist();
          }),
      )
      .addButton((b) =>
        b.setButtonText('Set value').onClick(() => {
          new SecretModal(
            this.app,
            this.host.settings.storage.accessKeyIdSecret,
            'S3 Access Key ID',
            'Public half of the S3 keypair. Safe to share — controls only ' +
              'which IAM user is signing.',
          ).open();
        }),
      );

    new Setting(c)
      .setName('Secret access key (secret name)')
      .setDesc(
        'Name used in secretStorage. Value is set via the "Set value" button.',
      )
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.secretAccessKeySecret)
          .onChange(async (v) => {
            this.host.settings.storage.secretAccessKeySecret = v.trim();
            await this.host.persist();
          }),
      )
      .addButton((b) =>
        b.setButtonText('Set value').onClick(() => {
          new SecretModal(
            this.app,
            this.host.settings.storage.secretAccessKeySecret,
            'S3 Secret Access Key',
            'Private half of the S3 keypair. Treat like a password.',
          ).open();
        }),
      );

    /* --- Test upload --- */

    new Setting(c)
      .setName('Test connection')
      .setDesc(
        'Uploads a tiny 4-byte test object to verify endpoint + credentials + ' +
          'path template all work end-to-end.',
      )
      .addButton((b) =>
        b.setButtonText('Test upload').onClick(async () => {
          await this.runTestUpload();
        }),
      );
  }

  private async runTestUpload(): Promise<void> {
    try {
      const accessKeyId = await getSecret(
        this.app,
        this.host.settings.storage.accessKeyIdSecret,
      );
      const secretAccessKey = await getSecret(
        this.app,
        this.host.settings.storage.secretAccessKeySecret,
      );

      if (!accessKeyId || !secretAccessKey) {
        new Notice('Set both S3 access key + secret first');
        return;
      }

      const client = new S3Client(this.host.settings.storage, {
        accessKeyId,
        secretAccessKey,
      });
      const key = await renderKey(this.host.settings.storage.pathTemplate, {
        date: new Date(),
        slug: '_firstfinger-test',
        filename: 'test.txt',
        bytes: new TextEncoder().encode('test').buffer,
      });

      await client.putObject(
        key,
        new TextEncoder().encode('test').buffer,
        'text/plain',
      );
      const url = publicUrlFor(this.host.settings.storage.publicUrlBase, key);

      new Notice(`Upload OK → ${url}`, 8000);
    } catch (e) {
      new Notice(
        `Test upload failed: ${e instanceof Error ? e.message : String(e)}`,
        10000,
      );
    }
  }

  /* ===== Git ===== */

  private renderGitSection(c: HTMLElement) {
    new Setting(c).setName('Git').setHeading();

    new Setting(c)
      .setName('Repo owner')
      .setDesc('GitHub user or organization that owns the repo.')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.owner)
          .onChange(async (v) => {
            this.host.settings.git.owner = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Repo name')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.repo)
          .onChange(async (v) => {
            this.host.settings.git.repo = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Branch')
      .setDesc('Default branch to commit to (usually main).')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.branch)
          .onChange(async (v) => {
            this.host.settings.git.branch = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('PAT (secret name)')
      .setDesc(
        'Name used in secretStorage. The actual PAT value is set via the ' +
          '"Set value" button. Needs at least the `contents: write` permission.',
      )
      .addText((t) =>
        t
          .setValue(this.host.settings.git.patSecret)
          .onChange(async (v) => {
            this.host.settings.git.patSecret = v.trim();
            await this.host.persist();
          }),
      )
      .addButton((b) =>
        b.setButtonText('Set value').onClick(() => {
          new SecretModal(
            this.app,
            this.host.settings.git.patSecret,
            'GitHub Personal Access Token',
            'Fine-grained PAT scoped to your blog repo with contents: write.',
          ).open();
        }),
      );

    new Setting(c)
      .setName('Author name')
      .setDesc('Commit author name (defaults to your Obsidian profile if blank).')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.authorName)
          .onChange(async (v) => {
            this.host.settings.git.authorName = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Author email')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.authorEmail)
          .onChange(async (v) => {
            this.host.settings.git.authorEmail = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Commit message template')
      .setDesc(
        'Used to label publish commits. Tokens: {slug} {title} {date}.',
      )
      .addText((t) =>
        t
          .setValue(this.host.settings.git.commitMessageTemplate)
          .onChange(async (v) => {
            this.host.settings.git.commitMessageTemplate = v;
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Verify access')
      .setDesc(
        'GET /repos/{owner}/{repo} to confirm the PAT has the right scope.',
      )
      .addButton((b) =>
        b.setButtonText('Test token').onClick(async () => {
          await this.runTestToken();
        }),
      );
  }

  private async runTestToken(): Promise<void> {
    try {
      const token = await getSecret(this.app, this.host.settings.git.patSecret);

      if (!token) {
        new Notice('Set the GitHub PAT first');
        return;
      }
      const result = await testAccess(this.host.settings.git, token);

      if (result.ok) {
        new Notice(`Token OK — ${this.host.settings.git.owner}/${this.host.settings.git.repo} is reachable`, 6000);
      } else {
        new Notice(
          `Token test failed (HTTP ${result.status}): ${result.message ?? ''}`,
          10000,
        );
      }
    } catch (e) {
      new Notice(
        `Token test errored: ${e instanceof Error ? e.message : String(e)}`,
        10000,
      );
    }
  }
}
