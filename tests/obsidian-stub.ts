/**
 * Minimal stand-in for the `obsidian` module so vitest can import code
 * that depends on it without a running Obsidian instance.
 *
 * Only the symbols our pure-logic modules actually touch are stubbed.
 * UI / runtime symbols (Plugin, Modal, Notice, ...) are stub classes
 * with empty methods — touching them in tests is a smell and should
 * be moved behind an interface.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function parseYaml(src: string): unknown {
  // Tiny shim — handles the simple `key: value` shape our parser passes
  // through. Real YAML edge cases aren't worth re-implementing here; tests
  // that need them should pass TOML or extend this stub.
  const out: Record<string, unknown> = {};

  for (const raw of src.split('\n')) {
    const line = raw.trim();

    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');

    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value === 'true') out[key] = true;
    else if (value === 'false') out[key] = false;
    else if (/^-?\d+$/.test(value)) out[key] = Number.parseInt(value, 10);
    else out[key] = value;
  }

  return out;
}

/** Minimal class stubs so `import { Plugin } from 'obsidian'` doesn't crash. */
export class Plugin {}
export class Modal {}
export class Notice {
  constructor(_msg: string, _timeout?: number) {}
}
export class Setting {
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
  setHeading() { return this; }
}
export class PluginSettingTab {}
export class FuzzySuggestModal {}
export class TFile {
  path = '';
  basename = '';
  name = '';
  parent: TFile | null = null;
}
export class TFolder {}
export class MarkdownView {}
export class Editor {}
export class App {}

export const requireApiVersion = () => true;
