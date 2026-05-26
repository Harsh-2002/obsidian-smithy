import { App, Editor } from 'obsidian';

import { ShortcodePicker } from '../ui/snippet-picker';

/**
 * "Insert Hugo shortcode" command — opens the fuzzy picker, inserts the
 * chosen snippet at the cursor.
 */
export function openShortcodePicker(app: App, editor: Editor): void {
  new ShortcodePicker(app, editor).open();
}
