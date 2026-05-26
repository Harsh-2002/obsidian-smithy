import { App, Notice, TFile } from 'obsidian';

import { getSecret } from '../secrets';
import type { PluginSettings } from '../types';

/**
 * "Smithy: Export settings" — one click → plain JSON config file in the
 * vault root.
 *
 * Why plain JSON instead of an encrypted bundle: the user explicitly
 * asked for the simplest possible UX. Trade-off: the file contains
 * your PAT + S3 secret + S3 access key in plaintext. Keep it private
 * (don't commit it to GitHub, don't share). Acts as a backup AND a
 * cross-device migration tool.
 *
 * Output path: `smithy-config.json` at vault root, overwritten each
 * time. The companion "Import settings" command defaults to the same
 * path so the round-trip is friction-free.
 */
export async function exportSettingsCommand(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  const OUTPUT_PATH = 'smithy-config.json';

  try {
    const [accessKey, secretKey, pat] = await Promise.all([
      getSecret(app, settings.storage.accessKeyIdSecret),
      getSecret(app, settings.storage.secretAccessKeySecret),
      getSecret(app, settings.git.patSecret),
    ]);

    // Strip per-vault state (publishHistory, welcomeModalDismissed) —
    // those are NOT config, they describe what happened on THIS device.
    // Re-importing them on another device would surface stale "published
    // 2h ago" timestamps for posts you haven't even touched there.
    const exportable = {
      schema: 'smithy-export.v1',
      exportedAt: new Date().toISOString(),
      pluginVersion: '2026.05.26',
      settings: {
        site: settings.site,
        storage: settings.storage,
        git: settings.git,
        autoRenameScreenshots: settings.autoRenameScreenshots,
      },
      // Bundled keyed by the secret NAMES in settings.* — import uses
      // the names to write back into the same slots.
      secrets: {
        [settings.storage.accessKeyIdSecret]: accessKey ?? '',
        [settings.storage.secretAccessKeySecret]: secretKey ?? '',
        [settings.git.patSecret]: pat ?? '',
      },
    };

    const serialized = JSON.stringify(exportable, null, 2);
    const existing = app.vault.getAbstractFileByPath(OUTPUT_PATH);

    if (existing instanceof TFile) {
      await app.vault.modify(existing, serialized);
    } else {
      await app.vault.create(OUTPUT_PATH, serialized);
    }

    new Notice(
      `Smithy config exported to ${OUTPUT_PATH}\n` +
        '⚠ Contains your PAT + S3 keys in plaintext — keep it private. ' +
        'Do NOT commit it to GitHub.',
      12000,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    new Notice(`Export failed: ${msg}`, 10000);
  }
}
