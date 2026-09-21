import { loadCarRuntime } from '../car/carRuntimeLoader';

type CarRuntimeModule = typeof import('../car/carModeRuntime');

let carRuntimeModule: CarRuntimeModule | null = null;

// Warm the lazy chunk at module load so cruise gear hops and cinema/snapshot
// cabin latching can read it synchronously once car mode has been touched.
void loadCarRuntime().then((module) => {
  carRuntimeModule = module;
});

/**
 * The car runtime, or `null` until the lazy chunk resolves.
 *
 * Callers must read this at call time, never capture it: before the chunk
 * lands (or outside car mode) there simply is no cabin, and every consumer
 * already degrades to a road-only result in that case.
 */
export function getCarRuntime(): CarRuntimeModule | null {
  return carRuntimeModule;
}
