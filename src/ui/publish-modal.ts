import { App, Modal, Setting } from 'obsidian';

import type {
  ProgressEvent,
  PipelinePhase,
} from '../publish/pipeline';
import type { PublishReport } from '../types';

/**
 * PublishModal — shown while the publish pipeline runs.
 *
 *   - Top: phase chip showing current step (validate → walk → ...).
 *   - Middle: per-asset upload progress (Uploading 3/7: foo.png).
 *   - Bottom: live warning list (resolution failures don't abort the
 *     pipeline; they show up here for the user to fix in v2).
 *   - On done: success state with links to the commit + live post.
 *   - On error: error state with the phase + reason + a Close button.
 *
 * The pipeline calls `onProgress(event)` which we route to setProgress.
 * Reporting `finish(report)` or `fail(message)` switches the modal into
 * its terminal state and leaves Close as the only button.
 */

const PHASE_ORDER: PipelinePhase[] = [
  'validate',
  'walk',
  'resolve',
  'upload',
  'rewrite',
  'commit',
];

export class PublishModal extends Modal {
  private currentPhase: PipelinePhase | null = null;
  private uploadStatus = '';
  private warnings: string[] = [];

  // DOM handles — undefined until onOpen runs. setProgress / finish / fail
  // can be called BEFORE onOpen (when the chip-first flow buffers events
  // and only opens the modal on warning/error), so every call site has to
  // null-check before touching them.
  private phaseEl: HTMLElement | undefined;
  private uploadEl: HTMLElement | undefined;
  private warningsEl: HTMLElement | undefined;
  private finishEl: HTMLElement | undefined;
  private closeButtonEl: HTMLButtonElement | undefined;

  // Buffered terminal state — applied at onOpen if the modal opens AFTER
  // the pipeline finished.
  private pendingFinish: PublishReport | undefined;
  private pendingFail: { phase: PipelinePhase | 'unknown'; message: string } | undefined;

  constructor(app: App, private readonly postName: string) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: `Publishing: ${this.postName}` });

    this.phaseEl = contentEl.createEl('p', {
      cls: 'smithy-phase',
      text: this.currentPhase
        ? `${phaseLabel(this.currentPhase)} (${currentStep(this.currentPhase)}/${PHASE_ORDER.length})`
        : 'starting…',
    });

    this.uploadEl = contentEl.createEl('p', {
      cls: 'smithy-upload',
      text: this.uploadStatus,
    });

    this.warningsEl = contentEl.createEl('div', {
      cls: 'smithy-warnings',
    });
    // Replay any warnings that arrived before onOpen.
    this.renderWarnings();

    this.finishEl = contentEl.createEl('div', {
      cls: 'smithy-finish',
    });

    new Setting(contentEl).addButton((b) => {
      b.setButtonText('Close').onClick(() => this.close());
      this.closeButtonEl = b.buttonEl;
      // Disable until the pipeline reports finish/fail.
      b.buttonEl.disabled = true;
    });

    // If the pipeline already finished/failed before the modal opened,
    // apply that terminal state now.
    if (this.pendingFinish) {
      this.finish(this.pendingFinish);
      this.pendingFinish = undefined;
    } else if (this.pendingFail) {
      this.fail(this.pendingFail.phase, this.pendingFail.message);
      this.pendingFail = undefined;
    }
  }

  /**
   * Pipeline progress hook. Called with each ProgressEvent in order.
   * Tolerant of being called BEFORE onOpen — state is stored on `this`
   * and rendered when (or if) the modal eventually opens.
   */
  setProgress(event: ProgressEvent) {
    switch (event.type) {
      case 'phase':
        if (event.status === 'start') {
          this.currentPhase = event.phase;
          this.phaseEl?.setText(
            `${phaseLabel(event.phase)} (${currentStep(event.phase)}/${PHASE_ORDER.length})`,
          );
        }
        break;
      case 'upload-progress':
        this.uploadStatus = `Uploading ${event.current}/${event.total}: ${event.filename}`;
        this.uploadEl?.setText(this.uploadStatus);
        break;
      case 'warning':
        this.warnings.push(event.warning.message);
        this.renderWarnings();
        break;
    }
  }

  /**
   * Switch to success state. Re-renders the body with commit + live links.
   * For dry-run reports the messaging shifts to "would upload" / "would
   * commit" and no commit URL is shown.
   *
   * If called before onOpen (chip-first flow when there are warnings),
   * the report is buffered and replayed on open.
   */
  finish(report: PublishReport) {
    if (!this.phaseEl || !this.uploadEl || !this.finishEl) {
      this.pendingFinish = report;
      return;
    }

    const dry = !!report.dryRun;

    this.phaseEl.setText(dry ? '— dry-run complete' : '✓ done');
    this.uploadEl.setText(
      report.uploaded.length === 0
        ? 'no attachments to upload'
        : dry
          ? `would upload ${report.uploaded.length} file(s)`
          : `uploaded ${report.uploaded.length} file(s)`,
    );

    this.finishEl.empty();
    this.finishEl.createEl('h3', { text: dry ? 'Dry run — nothing happened' : 'Published' });

    if (dry) {
      const note = this.finishEl.createEl('p');

      note.setText(
        'No S3 PUTs, no markdown rewrite, no git commit. ' +
          'Run "Publish current post" for real when ready.',
      );

      // List the planned uploads so the user can verify the keys.
      if (report.uploaded.length > 0) {
        this.finishEl.createEl('h4', { text: 'Would upload:' });
        const ul = this.finishEl.createEl('ul');

        for (const u of report.uploaded) {
          ul.createEl('li', { text: u.url });
        }
      }
    } else if (report.commit?.commitUrl) {
      this.finishEl.createEl('p').createEl('a', {
        text: 'view commit on GitHub',
        href: report.commit.commitUrl,
        attr: { target: '_blank', rel: 'noopener noreferrer' },
      });
    } else if (report.commit?.sha) {
      this.finishEl.createEl('p', {
        text: 'No-op commit (file content unchanged on the branch)',
      });
    }

    if (!dry && report.livePostUrl) {
      this.finishEl.createEl('p').createEl('a', {
        text: 'view live post',
        href: report.livePostUrl,
        attr: { target: '_blank', rel: 'noopener noreferrer' },
      });
    }

    // Workflow dispatch outcome — only relevant for real publishes.
    if (!dry && report.workflowDispatched === true) {
      this.finishEl.createEl('p', {
        text: '✓ build workflow triggered — site rebuild in progress',
        cls: 'setting-item-description',
      });
    } else if (!dry && report.workflowDispatched === false) {
      this.finishEl.createEl('p', {
        text: `⚠ build workflow dispatch failed: ${report.workflowDispatchError ?? 'unknown'} — site may not rebuild until the next push`,
        cls: 'setting-item-description',
      });
    }

    this.enableClose();
  }

  /**
   * Switch to error state. `phase` is the pipeline phase that failed.
   * If called before onOpen, buffered until the modal opens.
   */
  fail(phase: PipelinePhase | 'unknown', message: string) {
    if (!this.phaseEl || !this.finishEl) {
      this.pendingFail = { phase, message };
      return;
    }

    this.phaseEl.setText(`✗ ${phaseLabel(phase as PipelinePhase)} failed`);
    this.finishEl.empty();
    this.finishEl.createEl('h3', { text: 'Publish failed' });
    this.finishEl.createEl('p', { text: message });
    this.enableClose();
  }

  onClose() {
    this.contentEl.empty();
  }

  /* ---------- private ---------- */

  private renderWarnings() {
    if (this.warnings.length === 0 || !this.warningsEl) return;
    this.warningsEl.empty();
    this.warningsEl.createEl('h4', { text: `Warnings (${this.warnings.length})` });
    const ul = this.warningsEl.createEl('ul');

    for (const w of this.warnings) {
      ul.createEl('li', { text: w });
    }
  }

  private enableClose() {
    if (this.closeButtonEl) this.closeButtonEl.disabled = false;
  }
}

function phaseLabel(phase: PipelinePhase): string {
  switch (phase) {
    case 'validate':
      return 'Validating';
    case 'walk':
      return 'Scanning';
    case 'resolve':
      return 'Resolving';
    case 'upload':
      return 'Uploading';
    case 'rewrite':
      return 'Rewriting markdown';
    case 'commit':
      return 'Committing';
  }
}

function currentStep(phase: PipelinePhase): number {
  return PHASE_ORDER.indexOf(phase) + 1;
}
