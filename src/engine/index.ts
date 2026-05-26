import type { EngineAdapter, EngineId } from '../types';

import { HugoEngine } from './hugo';

/**
 * Registry of engine adapters. Only Hugo ships in v1; the indirection is
 * for future Jekyll / Astro / 11ty plugins.
 */
const ENGINES: Record<EngineId, EngineAdapter> = {
  hugo: HugoEngine,
};

export function getEngine(id: EngineId): EngineAdapter {
  const engine = ENGINES[id];

  if (!engine) {
    throw new Error(`unsupported engine: ${id}`);
  }

  return engine;
}

export { HugoEngine, slugFromPostPath } from './hugo';
