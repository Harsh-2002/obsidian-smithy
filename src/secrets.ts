import type { App } from 'obsidian';

/**
 * Wrapper around Obsidian's `app.secretStorage` API for storing API keys,
 * tokens, and other sensitive values outside `data.json`.
 *
 * Why: Obsidian's docs explicitly call out that secrets in `data.json` are
 * plaintext, shared if the vault is synced, and have to be duplicated across
 * every plugin that needs them. `app.secretStorage` puts the value in
 * vault-scoped localStorage and lets plugins reference it by NAME — so the
 * settings file only carries the name, and the value can be rotated in one
 * place.
 *
 * The API isn't in the public type bundle yet, so we feature-detect and
 * cast. If a runtime is too old to have it, fall back to a local
 * `localStorage` shim with a clear key prefix.
 */

/**
 * Shape of the runtime `secretStorage` object exposed on `app`.
 * Mirrored from Obsidian's docs.
 */
interface SecretStorageRuntime {
  get(name: string): Promise<string | undefined> | string | undefined;
  set(name: string, value: string): Promise<void> | void;
  remove?(name: string): Promise<void> | void;
}

type AppWithSecretStorage = App & { secretStorage?: SecretStorageRuntime };

/**
 * Get the secret for the given name. Returns `undefined` if unset or if the
 * runtime lacks secretStorage AND no fallback value exists.
 */
export async function getSecret(
  app: App,
  name: string,
): Promise<string | undefined> {
  if (!name) return undefined;

  const ss = (app as AppWithSecretStorage).secretStorage;

  if (ss && typeof ss.get === 'function') {
    return Promise.resolve(ss.get(name));
  }

  // Fallback: vault-scoped localStorage. Vault name is unique enough for
  // this purpose; settings sync between vaults is not a goal.
  return localStorage.getItem(fallbackKey(app, name)) ?? undefined;
}

export async function setSecret(
  app: App,
  name: string,
  value: string,
): Promise<void> {
  if (!name) throw new Error('secret name is required');

  const ss = (app as AppWithSecretStorage).secretStorage;

  if (ss && typeof ss.set === 'function') {
    await Promise.resolve(ss.set(name, value));

    return;
  }

  localStorage.setItem(fallbackKey(app, name), value);
}

export async function removeSecret(app: App, name: string): Promise<void> {
  if (!name) return;

  const ss = (app as AppWithSecretStorage).secretStorage;

  if (ss?.remove) {
    await Promise.resolve(ss.remove(name));

    return;
  }

  localStorage.removeItem(fallbackKey(app, name));
}

/**
 * True iff the runtime exposes secretStorage. The settings UI uses this to
 * decide whether to nudge users about runtime upgrades.
 */
export function hasSecretStorageRuntime(app: App): boolean {
  const ss = (app as AppWithSecretStorage).secretStorage;

  return !!(ss && typeof ss.get === 'function' && typeof ss.set === 'function');
}

function fallbackKey(app: App, name: string): string {
  const vault = app.vault.getName?.() ?? 'default';

  return `static-publisher.${vault}.${name}`;
}
