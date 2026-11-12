/**
 * Lazy loader for the heavy car-mode runtime (Three.js interior stack).
 * Import this from providers/hooks that must not pull `car/index.ts` into main.
 */
import { noteUnhandled } from '../debug/unhandledRejection';
import type { CarModeState } from './carModeRuntime';

export type { CarModeState };

type CarRuntime = typeof import('./carModeRuntime');

let runtimePromise: Promise<CarRuntime> | null = null;

/**
 * Load carModeRuntime once; shared across toggles and teardown. A rejected
 * import (flaky network, service-worker cache miss) is not cached: the next
 * call retries instead of replaying the failure until reload.
 */
export function loadCarRuntime(): Promise<CarRuntime> {
  if (!runtimePromise) {
    const attempt = import('./carModeRuntime');
    runtimePromise = attempt;
    attempt.catch(() => {
      if (runtimePromise === attempt) runtimePromise = null;
    });
  }
  return runtimePromise;
}

/**
 * Fire-and-forget use of the runtime: a load failure (or a throw from `use`)
 * is counted on `window.__SV__.errors` / the backend chip and logged, never
 * left as an unhandled rejection. Resolves once `use` has run (or failed).
 */
export function withCarRuntime(use: (runtime: CarRuntime) => unknown): Promise<void> {
  return loadCarRuntime()
    .then(use)
    .then(
      () => undefined,
      (error: unknown) => {
        console.warn('[carRuntime] load/use failed', error);
        noteUnhandled('rejection', error);
      },
    );
}
