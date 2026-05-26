import { App, Notice, TFile } from 'obsidian';

import { GitHubConflictError } from '../git/github-rest';
import { publishPost, PipelineError } from '../publish/pipeline';
import { ConflictModal } from '../ui/conflict-modal';
import { PublishModal } from '../ui/publish-modal';
import type { PluginSettings } from '../types';

/**
 * "Publish current post" — orchestrates the pipeline with live UI.
 *
 * Opens the PublishModal first so the user sees the validation phase
 * even when it fails fast. The modal stays open until the user closes
 * it, so success / failure summaries are persistent.
 */
export async function publishCurrentCommand(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) {
    new Notice('No active file');
    return;
  }

  const modal = new PublishModal(app, file.basename);

  modal.open();

  await runPublish(app, file, settings, modal);
}

async function runPublish(
  app: App,
  file: TFile,
  settings: PluginSettings,
  modal: PublishModal,
): Promise<void> {
  try {
    const report = await publishPost(app, file, settings, {
      onProgress: (e) => modal.setProgress(e),
    });

    modal.finish(report);
  } catch (e) {
    if (e instanceof GitHubConflictError) {
      // Read the rewritten body so the conflict modal can offer "copy
      // markdown" without re-rewriting.
      const rewritten = await app.vault.read(file);

      modal.fail('commit', e.message);

      new ConflictModal(app, {
        rewrittenBody: rewritten,
        onRetry: async () => {
          // After a successful pull, retry the publish with a fresh
          // modal so the user gets clean progress UI.
          const retryModal = new PublishModal(app, file.basename);

          retryModal.open();
          await runPublish(app, file, settings, retryModal);
        },
      }).open();

      return;
    }

    if (e instanceof PipelineError) {
      modal.fail(e.phase, e.message);
      return;
    }

    modal.fail('unknown', e instanceof Error ? e.message : String(e));
  }
}
