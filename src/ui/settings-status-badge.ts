import type { App } from 'obsidian';

import { checkConfiguredDeep } from '../util/check-configured';
import type { PluginSettings } from '../types';

/**
 * Top-of-settings status pill — 🟢 / 🟡 / 🔴 + one-line message.
 *
 *   - 🟢 Smithy is ready                — all 3 sections configured, all secrets set
 *   - 🟡 Almost there — N to set up   — some sections OK but secret values missing
 *   - 🔴 Smithy isn't connected yet     — at least one required section incomplete
 *
 * Clicking the pill scrolls to the first incomplete section. Once
 * everything's green the pill stays as a confirmation chip — it
 * doesn't disappear (the quick-start card already auto-hides; this is
 * the "yes, you're good" signal).
 */
export async function renderSettingsStatusBadge(
  containerEl: HTMLElement,
  app: App,
  settings: PluginSettings,
  scrollToSection: (which: 'site' | 'storage' | 'git') => void,
): Promise<void> {
  // Clean any previous badge before re-rendering.
  const prev = containerEl.querySelector('.smithy-status-badge');

  if (prev) prev.remove();

  const status = await checkConfiguredDeep(app, settings);
  const badge = containerEl.createDiv({ cls: 'smithy-status-badge' });

  let icon: string;
  let label: string;
  let kind: 'green' | 'yellow' | 'red';
  let jumpTo: 'site' | 'storage' | 'git' | null = null;

  if (status.ready) {
    icon = '🟢';
    label = 'Smithy is ready — publish with Mod+Shift+P';
    kind = 'green';
  } else if (!status.missing.site && !status.missing.storage && !status.missing.git) {
    // All sections have NAMES set but secret VALUES are missing.
    icon = '🟡';
    label = 'Almost there — set the secret values via "Set value" buttons below';
    kind = 'yellow';
    jumpTo = 'storage';
  } else {
    const missingCount =
      (status.missing.site ? 1 : 0) +
      (status.missing.storage ? 1 : 0) +
      (status.missing.git ? 1 : 0);

    icon = '🔴';
    label = `Smithy isn't connected yet — ${missingCount} section${missingCount === 1 ? '' : 's'} to fill in`;
    kind = 'red';
    jumpTo = status.missing.site
      ? 'site'
      : status.missing.storage
        ? 'storage'
        : 'git';
  }

  badge.addClass(`smithy-status-badge-${kind}`);
  badge.style.cursor = jumpTo ? 'pointer' : 'default';
  badge.createSpan({ text: `${icon}  ${label}` });

  if (jumpTo) {
    const target = jumpTo;

    badge.addEventListener('click', () => scrollToSection(target));
  }
}
