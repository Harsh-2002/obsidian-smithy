import { App, Notice, TFile } from 'obsidian';

import { getEngine } from '../engine';
import type { PluginSettings } from '../types';

/**
 * "Open published version" command — derives the active post's live
 * permalink via the engine adapter and opens it in the system browser.
 *
 * Closes the loop after publishing: you publish a post, want to verify
 * it's live, and you don't have to switch apps + type the URL.
 */
export function openPublishedCommand(
  app: App,
  settings: PluginSettings,
): boolean {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) {
    new Notice('No active file');
    return false;
  }

  const postsRoot = settings.site.postsFolder.replace(/\/+$/, '');

  if (!file.path.startsWith(postsRoot + '/')) {
    new Notice('Active file is not inside the posts folder');
    return false;
  }

  if (!settings.site.siteBaseUrl) {
    new Notice('Site base URL is not set — fill it in Settings → Site');
    return false;
  }

  const engine = getEngine(settings.site.engine);
  const permalink = engine.permalinkFor(file.path, settings);

  if (!permalink) {
    new Notice('Could not derive a permalink for this post');
    return false;
  }

  window.open(permalink, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * checkCallback predicate — used by main.ts to hide the command from the
 * palette when the active file isn't a post.
 */
export function canOpenPublished(
  app: App,
  settings: PluginSettings,
): boolean {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) return false;
  const postsRoot = settings.site.postsFolder.replace(/\/+$/, '');

  if (!file.path.startsWith(postsRoot + '/')) return false;
  if (!settings.site.siteBaseUrl) return false;

  return true;
}
