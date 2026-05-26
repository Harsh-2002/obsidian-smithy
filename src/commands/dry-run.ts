import { App, Notice, TFile } from 'obsidian';

import { publishPost, PipelineError, type ProgressEvent } from '../publish/pipeline';
import { PublishModal } from '../ui/publish-modal';
import type { PluginSettings } from '../types';

/**
 * "Dry-run publish current post" — runs the full pipeline with
 * `opts.dryRun: true`, which skips:
 *
 *   - S3 PUTs (would-be objects are listed in the report instead)
 *   - vault.process rewrite
 *   - GitHub commit
 *   - last_published frontmatter writeback
 *
 * Result is shown in the same PublishModal as a real publish, with a
 * DRY RUN header so the user knows nothing actually happened.
 *
 * Use case: "what would this publish do?" before clicking Publish for
 * real. Particularly useful when re-publishing a heavily edited post
 * and you want to see how many uploads + rewrites that implies.
 */
export async function dryRunCommand(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) {
    new Notice('No active file');
    return;
  }

  const modal = new PublishModal(app, `[DRY RUN] ${file.basename}`);

  modal.open();

  try {
    const report = await publishPost(app, file, settings, {
      onProgress: (e: ProgressEvent) => modal.setProgress(e),
      dryRun: true,
    });

    modal.finish(report);
  } catch (e) {
    if (e instanceof PipelineError) {
      modal.fail(e.phase, e.message);
      return;
    }
    modal.fail('unknown', e instanceof Error ? e.message : String(e));
  }
}
