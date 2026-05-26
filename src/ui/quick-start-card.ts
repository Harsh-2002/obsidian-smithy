import { checkConfigured } from '../util/check-configured';
import type { PluginSettings } from '../types';

/**
 * Quick-start card — renders at the top of the settings tab when the
 * plugin isn't yet fully configured. Each unmet section shows as a
 * bullet; clicking the bullet scrolls to that section. Once all three
 * sections have their core fields set, the card removes itself.
 *
 * Goal: a first-time user opens the settings panel and immediately
 * understands the 3 things to fill in instead of staring at 15 fields.
 *
 * The "is configured?" check lives in `src/util/check-configured.ts`
 * so the welcome modal + status badge + quick-start card all share
 * one definition.
 */

// Re-export for backward compat with any existing imports.
export { checkConfigured as checkQuickStart } from '../util/check-configured';

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
  const old = containerEl.querySelector('.smithy-quick-start');

  if (old) old.remove();

  const status = checkConfigured(settings);

  if (status.ready) return;

  const card = containerEl.createDiv({ cls: 'smithy-quick-start' });

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
