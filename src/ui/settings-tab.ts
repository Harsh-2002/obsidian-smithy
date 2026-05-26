import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { Plugin } from 'obsidian';

import { applyPreset, PROVIDER_PRESETS } from '../storage/presets';
import { getSecret } from '../secrets';
import { publicUrlFor, S3Client } from '../storage/s3-client';
import { renderKey } from '../storage/path-template';
import { testAccess } from '../git/github-rest';
import type { PluginSettings, ProviderPresetId } from '../types';

import { renderQuickStartCard } from './quick-start-card';
import { renderSettingsStatusBadge } from './settings-status-badge';
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

export class ForgeSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: SettingsTabHost,
    plugin: Plugin,
  ) {
    super(app, plugin);
  }

  /** Section anchor refs so the quick-start card can scroll to them. */
  private sectionEls: Partial<Record<'site' | 'storage' | 'git', HTMLElement>> = {};

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: 'Forge' });
    containerEl.createEl('p', {
      text:
        'One-command publish for Hugo blogs. Configure your S3-compatible ' +
        'storage and GitHub repo below, then use the "Publish current post" ' +
        'command from inside a post.',
      cls: 'setting-item-description',
    });

    // Status badge (🟢/🟡/🔴) — async because it checks secrets too.
    void renderSettingsStatusBadge(
      containerEl,
      this.app,
      this.host.settings,
      (which) => {
        this.sectionEls[which]?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      },
    );

    // Quick-start card — only renders when sections are missing core fields.
    renderQuickStartCard(containerEl, this.host.settings, (which) => {
      this.sectionEls[which]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    this.sectionEls.site = this.renderSiteSection(containerEl);
    this.sectionEls.storage = this.renderStorageSection(containerEl);
    this.sectionEls.git = this.renderGitSection(containerEl);
  }

  /* ===== Site ===== */

  private renderSiteSection(parent: HTMLElement): HTMLElement {
    const c = parent.createDiv({ cls: 'forge-section forge-section-site' });

    new Setting(c).setName('Site').setHeading();

    new Setting(c)
      .setName('Posts folder')
      .setDesc('Vault path holding your posts. e.g. content/posts')
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
      .setName('Site URL')
      .setDesc('Your live site\'s public URL.')
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
      .setDesc('Scaffold new posts with draft = true.')
      .addToggle((tog) =>
        tog
          .setValue(this.host.settings.site.newPostsAreDrafts)
          .onChange(async (v) => {
            this.host.settings.site.newPostsAreDrafts = v;
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Auto-rename pasted screenshots')
      .setDesc('Rename "Pasted image …" → <slug>-screenshot-N.<ext>')
      .addToggle((tog) =>
        tog
          .setValue(this.host.settings.autoRenameScreenshots)
          .onChange(async (v) => {
            this.host.settings.autoRenameScreenshots = v;
            await this.host.persist();
          }),
      );

    return c;
  }

  /* ===== Storage ===== */

  private renderStorageSection(parent: HTMLElement): HTMLElement {
    const c = parent.createDiv({ cls: 'forge-section forge-section-storage' });

    new Setting(c).setName('Storage').setHeading();

    new Setting(c)
      .setName('Provider')
      .setDesc('Pre-fills endpoint, region, path style.')
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
      .setDesc('Where attachments upload to.')
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
      .setDesc('S3 API endpoint. Replace {placeholders} with real values.')
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
      .setDesc('SigV4 region. R2 = "auto". AWS = e.g. us-east-1.')
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.region)
          .onChange(async (v) => {
            this.host.settings.storage.region = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Force path-style')
      .setDesc('Required for MinIO + some custom S3 servers.')
      .addToggle((tog) =>
        tog
          .setValue(this.host.settings.storage.forcePathStyle)
          .onChange(async (v) => {
            this.host.settings.storage.forcePathStyle = v;
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('CDN URL')
      .setDesc('Your CDN base — e.g. https://cdn.example.com')
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
      .setDesc('Tokens: {year} {month} {day} {slug} {filename} {ext} {hash}')
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
      .setName('Access key ID')
      .setDesc('Click "Set value" to enter the actual key.')
      .addText((t) =>
        t
          .setValue(this.host.settings.storage.accessKeyIdSecret)
          .onChange(async (v) => {
            this.host.settings.storage.accessKeyIdSecret = v.trim();
            await this.host.persist();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText('Create token')
          .setTooltip(
            'Open the relevant provider\'s API tokens page in a browser tab.',
          )
          .onClick(() => {
            // Open the provider's API token creation page. URL varies
            // by preset — we only have a deep-link for R2; others
            // open the provider's docs.
            const preset = this.host.settings.storage.preset;
            const url =
              preset === 'cloudflare_r2'
                ? 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens'
                : preset === 'aws_s3'
                  ? 'https://console.aws.amazon.com/iam/home#/users'
                  : preset === 'backblaze_b2'
                    ? 'https://secure.backblaze.com/app_keys.htm'
                    : preset === 'digitalocean_spaces'
                      ? 'https://cloud.digitalocean.com/account/api/spaces'
                      : preset === 'wasabi'
                        ? 'https://console.wasabisys.com/'
                        : 'https://duckduckgo.com/?q=' +
                          encodeURIComponent(`${preset} S3 API token`);

            window.open(url, '_blank', 'noopener,noreferrer');
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
      .setName('Secret access key')
      .setDesc('Click "Set value" to enter the actual key.')
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
      .setName('Test storage')
      .setDesc('PUT + DELETE a 4-byte object. Verifies endpoint + keys.')
      .addButton((b) =>
        b.setButtonText('Test upload').onClick(async () => {
          await this.runTestUpload();
        }),
      );

    return c;
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
        slug: '_forge-test',
        filename: 'test.txt',
        bytes: new TextEncoder().encode('test').buffer,
      });

      await client.putObject(
        key,
        new TextEncoder().encode('test').buffer,
        'text/plain',
      );
      const url = publicUrlFor(this.host.settings.storage.publicUrlBase, key);

      // Clean up the test blob — no need to leave it in the bucket after
      // we've verified the round-trip. Failure to delete is logged but
      // not surfaced (the upload itself already succeeded).
      const deleted = await client.deleteObject(key).catch(() => false);

      new Notice(
        deleted
          ? `Upload OK → ${url} (test object cleaned up)`
          : `Upload OK → ${url} (test object remains — delete manually if needed)`,
        8000,
      );
    } catch (e) {
      new Notice(
        `Test upload failed: ${e instanceof Error ? e.message : String(e)}`,
        10000,
      );
    }
  }

  /* ===== Git ===== */

  private renderGitSection(parent: HTMLElement): HTMLElement {
    const c = parent.createDiv({ cls: 'forge-section forge-section-git' });

    new Setting(c).setName('Git').setHeading();

    // Why-a-PAT explainer (collapsible). Common new-user question:
    // "if I have the repo cloned with write access, why do I need a
    // PAT?" — Forge doesn't use git at all, it uses GitHub's REST API
    // so the same flow works on iPhone. The PAT replaces SSH keys + git
    // credential helpers.
    const explainer = c.createEl('details', { cls: 'forge-explainer' });

    explainer.createEl('summary', {
      text: 'Why does Forge need a PAT instead of using git push?',
    });
    const body = explainer.createEl('div', { cls: 'forge-explainer-body' });

    body.createEl('p', {
      text:
        "Forge talks to GitHub's web API instead of running `git push`. " +
        'This is on purpose: the same code works on desktop AND iPhone — ' +
        'no git binary, no SSH keys, no credential helpers per device.',
    });
    body.createEl('p', {
      text:
        'A Personal Access Token is your write access for that API. One ' +
        'secret, set once per device, works the same everywhere. Your ' +
        'vault never has to be a git clone — Forge bridges it to the ' +
        'remote repo for you.',
    });

    new Setting(c)
      .setName('Repo owner')
      .setDesc('GitHub user or org. Or paste "owner/repo" — we\'ll split it.')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.owner)
          .onChange(async (v) => {
            const trimmed = v.trim();

            // Convenience: if the user pastes "owner/repo" into the
            // owner field, split it across both. Avoids the common
            // "huh, where's the slash go?" friction.
            if (trimmed.includes('/')) {
              const [owner, repo] = trimmed.split('/', 2);

              this.host.settings.git.owner = owner;
              this.host.settings.git.repo = repo;
              await this.host.persist();
              this.display(); // re-render so the repo field reflects the split
              return;
            }
            this.host.settings.git.owner = trimmed;
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
      .setDesc('Usually main.')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.branch)
          .onChange(async (v) => {
            this.host.settings.git.branch = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Personal access token')
      .setDesc('Needs Contents: write. Use Create token for a preset URL.')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.patSecret)
          .onChange(async (v) => {
            this.host.settings.git.patSecret = v.trim();
            await this.host.persist();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText('Create token')
          .setTooltip(
            'Opens GitHub with the right scopes preselected (classic PAT). ' +
              'Fine-grained PATs work too but need manual scope selection.',
          )
          .onClick(() => {
            // Classic PAT creation URL with the `repo` scope (covers
            // contents:write on both public + private repos) preselected.
            // GitHub respects scopes + description query params for
            // CLASSIC tokens only — fine-grained tokens require manual
            // setup in their UI.
            const url =
              'https://github.com/settings/tokens/new' +
              '?description=Forge%20publish%20token' +
              '&scopes=repo';

            window.open(url, '_blank', 'noopener,noreferrer');
          }),
      )
      .addButton((b) =>
        b.setButtonText('Set value').onClick(() => {
          new SecretModal(
            this.app,
            this.host.settings.git.patSecret,
            'GitHub Personal Access Token',
            'Fine-grained PAT scoped to your blog repo with Contents: write, ' +
              'or a classic PAT with `repo` scope.',
          ).open();
        }),
      );

    new Setting(c)
      .setName('Author name')
      .setDesc('Shown in commit author.')
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
      .setDesc('Tokens: {slug} {title} {date}')
      .addText((t) =>
        t
          .setValue(this.host.settings.git.commitMessageTemplate)
          .onChange(async (v) => {
            this.host.settings.git.commitMessageTemplate = v;
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Auto-trigger workflow')
      .setDesc('Workflow file to dispatch after commit. Blank = off.')
      .addText((t) =>
        t
          .setPlaceholder('deploy.yml')
          .setValue(this.host.settings.git.dispatchWorkflow)
          .onChange(async (v) => {
            this.host.settings.git.dispatchWorkflow = v.trim();
            await this.host.persist();
          }),
      );

    new Setting(c)
      .setName('Verify')
      .setDesc('Test storage + GitHub.')
      .addButton((b) =>
        b.setButtonText('Test token').onClick(async () => {
          await this.runTestToken();
        }),
      )
      .addButton((b) =>
        b
          .setButtonText('Test all')
          .setCta()
          .setTooltip(
            'Run both Test upload and Test token — one click, one notice.',
          )
          .onClick(async () => {
            await this.runTestAll();
          }),
      );

    return c;
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

  /**
   * Run both Test upload + Test token sequentially and surface ONE notice
   * with annotated outcomes. Saves users two clicks plus the cognitive
   * load of running two checks in sequence.
   *
   * Failure messages aim to be ACTIONABLE — instead of "Storage ✗",
   * we report the specific permission missing or the HTTP status so
   * the user can fix it directly. R2 example: a 403 on PUT means
   * "Object Read & Write permission missing on the bucket".
   */
  private async runTestAll(): Promise<void> {
    const parts: string[] = [];

    // ---- Storage ----
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
        parts.push('Storage ✗ — secrets unset (click "Set value" next to access + secret key)');
      } else {
        const client = new S3Client(this.host.settings.storage, {
          accessKeyId,
          secretAccessKey,
        });
        const key = await renderKey(this.host.settings.storage.pathTemplate, {
          date: new Date(),
          slug: '_forge-test',
          filename: 'test.txt',
          bytes: new TextEncoder().encode('test').buffer,
        });

        await client.putObject(
          key,
          new TextEncoder().encode('test').buffer,
          'text/plain',
        );
        await client.deleteObject(key).catch(() => false);
        parts.push('Storage ✓');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Heuristic: turn the raw error into something actionable.
      const detail = explainStorageError(msg);

      parts.push(`Storage ✗ — ${detail}`);
    }

    // ---- Git ----
    try {
      const token = await getSecret(this.app, this.host.settings.git.patSecret);

      if (!token) {
        parts.push('GitHub ✗ — PAT unset (click "Set value" next to Personal access token)');
      } else {
        const result = await testAccess(this.host.settings.git, token);

        if (result.ok) {
          parts.push('GitHub ✓');
        } else {
          const detail = explainGitError(result.status, result.message);

          parts.push(`GitHub ✗ — ${detail}`);
        }
      }
    } catch (e) {
      parts.push(
        `GitHub ✗ — ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    new Notice(`Forge test — ${parts.join('\n')}`, 12000);
  }
}

/**
 * Turn a raw S3 / R2 error message into one the user can act on.
 */
function explainStorageError(raw: string): string {
  const low = raw.toLowerCase();

  if (low.includes('forbidden') || low.includes('403') || low.includes('accessdenied')) {
    return 'endpoint reachable but PUT denied (check Object Read & Write perm on the bucket)';
  }
  if (low.includes('signaturedoesnotmatch') || low.includes('invalidaccesskeyid')) {
    return 'keys rejected (access key or secret looks wrong)';
  }
  if (low.includes('nosuchbucket')) {
    return 'bucket does not exist on this account';
  }
  if (low.includes('failed to fetch') || low.includes('cors')) {
    return 'CORS blocked — add Obsidian origins to the bucket CORS rules';
  }

  return raw.slice(0, 140);
}

/**
 * Turn a GitHub REST API status + body into actionable advice.
 */
function explainGitError(status: number, raw: string | undefined): string {
  if (status === 401) return 'token rejected (expired or wrong account)';
  if (status === 403) {
    return raw && raw.toLowerCase().includes('rate limit')
      ? 'rate-limited (try again in a few minutes)'
      : 'token authenticated but lacks Contents access on this repo';
  }
  if (status === 404) {
    return 'repo not found (check owner / name; for private repos the PAT needs access)';
  }
  if (status === 422) return 'request was invalid (open an issue if this persists)';
  if (status >= 500) return `GitHub is having problems (HTTP ${status})`;

  return `HTTP ${status}${raw ? ' — ' + raw.slice(0, 100) : ''}`;
}
