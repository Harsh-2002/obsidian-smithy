import { App, Notice, TFile } from 'obsidian';

import { GitHubConflictError } from '../git/github-rest';
import { publishPost, PipelineError, type ProgressEvent } from '../publish/pipeline';
import { ConflictModal } from '../ui/conflict-modal';
import { PublishModal } from '../ui/publish-modal';
import type { StatusBarChip } from '../ui/status-bar';
import type { PluginSettings } from '../types';

/**
 * "Publish current post" — runs the publish pipeline with the status-bar
 * chip as the primary progress UI, falling back to the PublishModal only
 * when there are warnings or errors that need detail.
 *
 * Non-blocking by default: the user keeps editing while uploads + commit
 * proceed in the background. The chip shows live phase status; the modal
 * only auto-opens on warnings or failure.
 */
export async function publishCurrentCommand(
  app: App,
  settings: PluginSettings,
  chip: StatusBarChip | null,
): Promise<void> {
  const file = app.workspace.getActiveFile();

  if (!file || !(file instanceof TFile)) {
    new Notice('No active file');
    return;
  }

  // Build the modal up front but DON'T open it. It records progress so
  // it's correct if we need to show it later (warning or error).
  const modal = new PublishModal(app, file.basename);
  let modalOpened = false;
  const showModalIfHidden = () => {
    if (!modalOpened) {
      modal.open();
      modalOpened = true;
    }
  };

  await runPublish(app, file, settings, chip, modal, showModalIfHidden);
}

async function runPublish(
  app: App,
  file: TFile,
  settings: PluginSettings,
  chip: StatusBarChip | null,
  modal: PublishModal,
  showModalIfHidden: () => void,
): Promise<void> {
  const handleProgress = (e: ProgressEvent) => {
    // Status-bar chip always reflects current state.
    if (chip) {
      if (e.type === 'phase' && e.status === 'start') {
        chip.setPublishing(e.phase);
      } else if (e.type === 'upload-progress') {
        chip.setPublishing('upload', `Uploading ${e.current}/${e.total}`);
      } else if (e.type === 'warning') {
        // A warning auto-opens the modal so the user sees the message.
        showModalIfHidden();
      }
    }

    // Modal records the event regardless of whether it's open yet — if
    // we open it later, its state is correct.
    modal.setProgress(e);
  };

  try {
    const report = await publishPost(app, file, settings, {
      onProgress: handleProgress,
    });

    chip?.setPublishing(null);
    chip?.refresh();

    if (report.warnings.length > 0 || report.uploaded.length > 0) {
      // Show the modal so the user sees what changed.
      showModalIfHidden();
      modal.finish(report);
    } else if (report.commit?.commitUrl) {
      new Notice(`Forge: published ${file.basename} ✓`, 4000);
    } else {
      // No-op commit (content unchanged on remote).
      new Notice(`Forge: ${file.basename} — no changes to publish`, 4000);
    }
  } catch (e) {
    chip?.setPublishing(null);
    chip?.refresh();
    showModalIfHidden();

    if (e instanceof GitHubConflictError) {
      const rewritten = await app.vault.read(file);

      modal.fail('commit', e.message);

      new ConflictModal(app, {
        rewrittenBody: rewritten,
        onRetry: async () => {
          const retryModal = new PublishModal(app, file.basename);

          retryModal.open();
          await runPublish(
            app,
            file,
            settings,
            chip,
            retryModal,
            () => undefined,
          );
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
