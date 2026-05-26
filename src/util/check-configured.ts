import type { App } from 'obsidian';

import { getSecret } from '../secrets';
import type { PluginSettings } from '../types';

/**
 * Single source of truth for "is Forge configured?" used by:
 *
 *   - QuickStartCard (settings tab)
 *   - WelcomeModal (first-run trigger)
 *   - SettingsStatusBadge (top-of-settings 🟢/🟡/🔴 pill)
 *
 * Two flavors:
 *
 *   - `checkConfigured(settings)` — synchronous, NAMES-only. Looks at
 *     whether the must-have field NAMES are set. Doesn't know whether
 *     the actual secret VALUES exist (that's a secretStorage round-trip).
 *   - `checkConfiguredDeep(app, settings)` — async, also verifies the
 *     three secrets actually have values stored. Used for the status
 *     badge so it doesn't say "🟢 ready" when the PAT secret is empty.
 */

export interface ConfigCheckResult {
  /** True iff every required section is configured. */
  ready: boolean;
  missing: {
    site: boolean;
    storage: boolean;
    git: boolean;
  };
  /**
   * Set when `checkConfiguredDeep` was used and at least one secret
   * VALUE is empty even though its NAME is set. Always false for the
   * sync variant.
   */
  secretsMissing?: boolean;
}

export function checkConfigured(s: PluginSettings): ConfigCheckResult {
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
 * Async variant that also confirms the three secrets actually have
 * values stored in app.secretStorage. The status badge uses this so
 * the 🟢 state reflects "can publish right now" rather than "field
 * names look right."
 */
export async function checkConfiguredDeep(
  app: App,
  s: PluginSettings,
): Promise<ConfigCheckResult> {
  const surface = checkConfigured(s);

  if (!surface.ready) return surface;

  const [accessKey, secretKey, pat] = await Promise.all([
    getSecret(app, s.storage.accessKeyIdSecret),
    getSecret(app, s.storage.secretAccessKeySecret),
    getSecret(app, s.git.patSecret),
  ]);

  const secretsMissing = !accessKey || !secretKey || !pat;

  return {
    ready: !secretsMissing,
    missing: surface.missing,
    secretsMissing,
  };
}

/**
 * Heuristic for "should the welcome modal auto-open?" — only when this
 * looks like a truly fresh install. Conservative on purpose so existing
 * configured users never see it again.
 */
export async function isFreshInstall(
  app: App,
  s: PluginSettings,
): Promise<boolean> {
  if (s.welcomeModalDismissed) return false;
  if (s.git.owner || s.site.siteBaseUrl) return false;

  const pat = await getSecret(app, s.git.patSecret);

  return !pat;
}
