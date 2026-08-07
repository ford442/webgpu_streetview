/**
 * Lazy loader for the heavy car-mode runtime (Three.js interior stack).
 * Import this from providers/hooks that must not pull `car/index.ts` into main.
 */
import type { CarModeState } from './carModeRuntime';

export type { CarModeState };

let runtimePromise: Promise<typeof import('./carModeRuntime')> | null = null;

/** Load carModeRuntime once; shared across toggles and teardown. */
export function loadCarRuntime(): Promise<typeof import('./carModeRuntime')> {
  if (!runtimePromise) {
    runtimePromise = import('./carModeRuntime');
  }
  return runtimePromise;
}
