import { checkConfigured } from '../util/check-configured';
import type { PluginSettings } from '../types';

/**
 * Quick-start card — renders at the top of the settings tab when the
 * plugin isn't yet fully configured. Lists the missing sections as
 * plain numbered items. Once everything's configured, the card
 * removes itself.
 *
 * Design note (v0.5 polish): we tried rendering each item as a
 * clickable <a> that scrolled to the section. Result: redundant
 * "1.", "2.", "3." prefixes plus default <ul> bullets plus link
 * underlines — visually noisy. Now it's a plain <ol> with no link
 * styling; the section <h2> headings below are scroll targets if
 * the user wants to jump.
 *
 * The "is configured?" check lives in `src/util/check-configured.ts`
 * so the welcome modal + status badge + quick-start card all share
 * one definition.
 */

// Re-export for backward compat with any existing imports.
export { checkConfigured as checkQuickStart } from '../util/check-configured';

export function renderQuickStartCard(
  containerEl: HTMLElement,
  settings: PluginSettings,
  // Kept in the signature for API compatibility with callers, even
  // though the card no longer needs to jump — settings are right below.
  _scrollToSection?: (which: 'site' | 'storage' | 'git') => void,
): void {
  const old = containerEl.querySelector('.smithy-quick-start');

  if (old) old.remove();

  const status = checkConfigured(settings);

  if (status.ready) return;

  const card = containerEl.createDiv({ cls: 'smithy-quick-start' });

  card.createEl('h3', { text: 'Get started' });
  card.createEl('p', {
    text: 'Fill in these sections below to start publishing:',
    cls: 'setting-item-description',
  });

  const ol = card.createEl('ol');

  if (status.missing.site) {
    ol.createEl('li', {
      text: 'Site — your posts folder + the live site URL',
    });
  }
  if (status.missing.storage) {
    ol.createEl('li', {
      text: 'Storage — provider preset + bucket + endpoint + S3 keys',
    });
  }
  if (status.missing.git) {
    ol.createEl('li', {
      text: 'Git — repo owner / name / branch + GitHub PAT',
    });
  }

  card.createEl('p', {
    text:
      'When all three are filled, scroll to "Verify" and click Test all ' +
      'to confirm everything works before your first publish.',
    cls: 'setting-item-description',
  });
}
