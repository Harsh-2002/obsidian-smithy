import { App, Editor, FuzzySuggestModal } from 'obsidian';

import { SHORTCODES, type ShortcodeDef } from './shortcodes';

/**
 * Fuzzy-search picker for Hugo shortcodes. Triggered by the
 * "Insert Hugo shortcode" command. Inserts the chosen shortcode at
 * the editor's cursor position; if `${cursor}` is present in the
 * template, the caret lands there after insertion.
 */
export class ShortcodePicker extends FuzzySuggestModal<ShortcodeDef> {
  constructor(
    app: App,
    private readonly editor: Editor,
  ) {
    super(app);
    this.setPlaceholder('shortcode…');
  }

  getItems(): ShortcodeDef[] {
    return SHORTCODES;
  }

  getItemText(item: ShortcodeDef): string {
    return `${item.label} — ${item.description}`;
  }

  onChooseItem(item: ShortcodeDef): void {
    const tpl = item.template;
    const cursorMarker = '${cursor}';
    const idx = tpl.indexOf(cursorMarker);
    const insertText = idx < 0 ? tpl : tpl.replace(cursorMarker, '');

    const from = this.editor.getCursor();

    this.editor.replaceRange(insertText, from);

    if (idx >= 0) {
      // Compute the position of where ${cursor} was in the inserted text.
      const before = tpl.slice(0, idx).replace(cursorMarker, '');
      const newCursor = advanceCursor(from, before);

      this.editor.setCursor(newCursor);
    }
  }
}

/**
 * Advance an editor cursor through a string that may contain newlines.
 * Returns the resulting line/ch position.
 */
function advanceCursor(
  from: { line: number; ch: number },
  text: string,
): { line: number; ch: number } {
  let line = from.line;
  let ch = from.ch;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      ch = 0;
    } else {
      ch++;
    }
  }

  return { line, ch };
}
