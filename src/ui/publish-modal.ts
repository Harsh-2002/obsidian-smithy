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

  // DOM handles
  private phaseEl!: HTMLElement;
  private uploadEl!: HTMLElement;
  private warningsEl!: HTMLElement;
  private finishEl!: HTMLElement;
  private closeButtonEl?: HTMLButtonElement;

  constructor(app: App, private readonly postName: string) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl('h2', { text: `Publishing: ${this.postName}` });

    this.phaseEl = contentEl.createEl('p', {
      cls: 'static-publisher-phase',
      text: 'starting…',
    });

    this.uploadEl = contentEl.createEl('p', {
      cls: 'static-publisher-upload',
      text: '',
    });

    this.warningsEl = contentEl.createEl('div', {
      cls: 'static-publisher-warnings',
    });

    this.finishEl = contentEl.createEl('div', {
      cls: 'static-publisher-finish',
    });

    new Setting(contentEl).addButton((b) => {
      b.setButtonText('Close').onClick(() => this.close());
      this.closeButtonEl = b.buttonEl;
      // Disable until the pipeline reports finish/fail.
      b.buttonEl.disabled = true;
    });
  }

  /**
   * Pipeline progress hook. Called with each ProgressEvent in order.
   */
  setProgress(event: ProgressEvent) {
    switch (event.type) {
      case 'phase':
        if (event.status === 'start') {
          this.currentPhase = event.phase;
          this.phaseEl.setText(
            `${phaseLabel(event.phase)} (${currentStep(event.phase)}/${PHASE_ORDER.length})`,
          );
        }
        break;
      case 'upload-progress':
        this.uploadStatus = `Uploading ${event.current}/${event.total}: ${event.filename}`;
        this.uploadEl.setText(this.uploadStatus);
        break;
      case 'warning':
        this.warnings.push(event.warning.message);
        this.renderWarnings();
        break;
    }
  }

  /**
   * Switch to success state. Re-renders the body with commit + live links.
   */
  finish(report: PublishReport) {
    this.phaseEl.setText('✓ done');
    this.uploadEl.setText(
      report.uploaded.length === 0
        ? 'no attachments to upload'
        : `uploaded ${report.uploaded.length} file(s)`,
    );

    this.finishEl.empty();
    this.finishEl.createEl('h3', { text: 'Published' });

    if (report.commit?.commitUrl) {
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

    if (report.livePostUrl) {
      this.finishEl.createEl('p').createEl('a', {
        text: 'view live post',
        href: report.livePostUrl,
        attr: { target: '_blank', rel: 'noopener noreferrer' },
      });
    }

    this.enableClose();
  }

  /**
   * Switch to error state. `phase` is the pipeline phase that failed.
   */
  fail(phase: PipelinePhase | 'unknown', message: string) {
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
    if (this.warnings.length === 0) return;
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
