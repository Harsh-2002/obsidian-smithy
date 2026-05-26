import type { PluginSettings } from '../types';

/**
 * Quick-start card — renders at the top of the settings tab when the
 * plugin isn't yet fully configured. Each unmet section shows as a
 * bullet; clicking the bullet scrolls to that section. Once all three
 * sections have their core fields set, the card removes itself.
 *
 * Goal: a first-time user opens the settings panel and immediately
 * understands the 3 things to fill in instead of staring at 15 fields.
 */

export interface QuickStartCheckResult {
  /** True iff all three sections have their core fields set. */
  ready: boolean;
  missing: {
    site: boolean;
    storage: boolean;
    git: boolean;
  };
}

/**
 * Decide whether each section is "configured." Soft definition: just
 * the must-have fields, NOT the optional ones. Secret VALUES (in
 * secretStorage) aren't checked here — the user can see if those are
 * set inline via the Test buttons.
 */
export function checkQuickStart(s: PluginSettings): QuickStartCheckResult {
  const siteOk = !!s.site.postsFolder && !!s.site.siteBaseUrl;
  const storageOk =
    !!s.storage.bucket &&
    !!s.storage.endpoint &&
    !!s.storage.publicUrlBase &&
    !!s.storage.accessKeyIdSecret &&
    !!s.storage.secretAccessKeySecret;
  const gitOk = !!s.git.owner && !!s.git.repo && !!s.git.patSecret;

  return {
    ready: siteOk && storageOk && gitOk,
    missing: { site: !siteOk, storage: !storageOk, git: !gitOk },
  };
}

/**
 * Render the card into the given container element. Caller is expected
 * to call `renderQuickStartCard` whenever settings change so the card
 * disappears as the user fills in fields.
 */
export function renderQuickStartCard(
  containerEl: HTMLElement,
  settings: PluginSettings,
  scrollToSection: (which: 'site' | 'storage' | 'git') => void,
): void {
  // Always clean out any previous card before checking.
  const old = containerEl.querySelector('.forge-quick-start');

  if (old) old.remove();

  const status = checkQuickStart(settings);

  if (status.ready) return;

  const card = containerEl.createDiv({ cls: 'forge-quick-start' });

  card.createEl('h3', { text: 'Get started in 3 steps' });
  card.createEl('p', {
    text:
      'Fill in the unfinished sections below to start publishing. ' +
      'Click each item to jump there.',
    cls: 'setting-item-description',
  });

  const ul = card.createEl('ul');

  if (status.missing.site) {
    const li = ul.createEl('li');
    const link = li.createEl('a', {
      text: '1. Site — set your posts folder + live site URL',
      attr: { href: '#' },
    });

    link.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToSection('site');
    });
  }

  if (status.missing.storage) {
    const li = ul.createEl('li');
    const link = li.createEl('a', {
      text: '2. Storage — pick a provider preset, fill bucket / endpoint / CDN URL, set the S3 keys',
      attr: { href: '#' },
    });

    link.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToSection('storage');
    });
  }

  if (status.missing.git) {
    const li = ul.createEl('li');
    const link = li.createEl('a', {
      text: '3. Git — fill repo owner / name / branch, set your GitHub PAT',
      attr: { href: '#' },
    });

    link.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToSection('git');
    });
  }

  card.createEl('p', {
    text:
      'After all three sections are filled, use the Test all button to ' +
      'verify your config before publishing your first post.',
    cls: 'setting-item-description',
  });
}
