import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';

import { slugify } from './slug';
import type { PluginSettings } from '../types';

/**
 * Auto-rename pasted screenshots inside the configured posts folder.
 *
 * Obsidian's paste-image handler creates files with names like:
 *
 *   Pasted image 20260526123456.png
 *
 * When the user has the "auto rename" toggle ON and the file:
 *   - was just created (vault.on('create'))
 *   - matches the pasted-image pattern
 *   - is inside the configured posts folder
 * we rename it to `<post-slug>-screenshot-<N>.<ext>`, where post-slug
 * comes from the post's folder name (or its frontmatter title), and N
 * is the next sequential number that doesn't collide with siblings.
 *
 * Conflicts (target name exists) → silently fall back to the original
 * pasted-image name; we never block the paste, never throw.
 *
 * If the "Custom Attachment Location" plugin is installed, we DEFER —
 * that plugin owns attachment-naming and our renaming would fight it.
 */

const PASTED_PATTERN = /^Pasted image \d{14}\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i;

export interface PasteRenameContext {
  app: App;
  settings: PluginSettings;
}

/**
 * Returns a `disconnect` function to remove the listener; main.ts wires
 * it through `this.registerEvent` so Obsidian's plugin lifecycle handles
 * cleanup on unload.
 */
export function attachPasteRenameListener(ctx: PasteRenameContext): () => void {
  // Refuse to engage if Custom Attachment Location is installed —
  // overlapping renames cause file-not-found cascades. Surface a one-time
  // notice so the user knows the toggle is being ignored.
  if (hasCustomAttachmentLocation(ctx.app) && ctx.settings.autoRenameScreenshots) {
    new Notice(
      'Smithy: auto-rename screenshots disabled (Custom Attachment Location plugin detected). ' +
        'Disable that plugin if you want Smithy to handle naming.',
      8000,
    );

    return () => undefined;
  }

  const handler = (file: TFile) => {
    if (!ctx.settings.autoRenameScreenshots) return;
    if (!PASTED_PATTERN.test(file.name)) return;
    if (!isInPostsFolder(file, ctx.settings)) return;

    void renameOne(ctx, file);
  };

  ctx.app.vault.on('create', handler);
  return () => ctx.app.vault.off('create', handler);
}

async function renameOne(
  ctx: PasteRenameContext,
  file: TFile,
): Promise<void> {
  const slug = postSlugFor(file, ctx.settings);
  const ext = (file.extension || 'png').toLowerCase();
  const folder = file.parent?.path ?? '';

  // Find the next sequential N that doesn't already exist.
  for (let n = 1; n <= 999; n++) {
    const candidate = `${folder ? folder + '/' : ''}${slug}-screenshot-${n}.${ext}`;

    if (!ctx.app.vault.getAbstractFileByPath(candidate)) {
      try {
        await ctx.app.fileManager.renameFile(file, candidate);
      } catch {
        // Silent fallback — Obsidian sometimes refuses if the file is
        // already being moved (race against the paste handler). Leave
        // the original name; the user can rename manually.
      }
      return;
    }
  }
}

function isInPostsFolder(file: TFile, settings: PluginSettings): boolean {
  const root = settings.site.postsFolder.replace(/\/+$/, '') + '/';

  return file.path.startsWith(root);
}

/**
 * Derive a slug for the screenshot filename:
 *   1. If the file's parent folder is inside a post bundle, use the
 *      post folder name (most common case for Hugo page bundles).
 *   2. Otherwise, fall back to the file's parent folder name.
 */
function postSlugFor(file: TFile, settings: PluginSettings): string {
  const postsRoot = settings.site.postsFolder.replace(/\/+$/, '');

  // file.path is like content/posts/my-post/attachments/Pasted image....
  // Strip the postsRoot prefix and take the first segment.
  if (file.path.startsWith(postsRoot + '/')) {
    const rel = file.path.slice(postsRoot.length + 1);
    const slash = rel.indexOf('/');

    return slugify(slash < 0 ? rel : rel.slice(0, slash));
  }

  return slugify(file.parent?.name ?? 'post');
}

function hasCustomAttachmentLocation(app: App): boolean {
  // `app.plugins.plugins` keys list every enabled community plugin id.
  const plugins = (
    app as App & {
      plugins?: { plugins?: Record<string, unknown> };
    }
  ).plugins?.plugins;

  return !!plugins && 'obsidian-custom-attachment-location' in plugins;
}
