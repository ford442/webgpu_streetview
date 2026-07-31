/**
 * src/wasm/useWasmModule.ts
 * React hook for lazy-loading the StreetView WASM module.
 *
 * Usage:
 *   const { wasm, loading } = useWasmModule();
 *   if (wasm) {
 *     wasm.seed(Date.now());
 *     const n = wasm.noise2d(x, y);
 *   }
 *
 * The hook is safe to call in multiple components – the module is
 * loaded only once and the same instance is shared across all consumers.
 *
 * @remarks These hooks have no current app consumers; the active WASM integration
 * path is WasmNoiseFeeder (src/wasm/wasmNoiseFeeder.ts) which is called
 * imperatively from WebGPUCanvas.tsx.  These hooks are kept for future
 * React-based consumers (WeatherPanel, WindAudio, particle DSP etc.).
 */

import { useState, useEffect, useCallback } from 'react';
import { loadWasmModule, type StreetViewWasmAPI } from './index';

export interface UseWasmModuleResult {
  /** The loaded API, or null while loading. */
  wasm: StreetViewWasmAPI | null;
  /** True while the WASM binary is being fetched. */
  loading: boolean;
}

export function useWasmModule(): UseWasmModuleResult {
  const [wasm, setWasm] = useState<StreetViewWasmAPI | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadWasmModule().then((mod) => {
      if (!cancelled) {
        setWasm(mod);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { wasm, loading };
}

/**
 * Hook that provides a noise2d sampler function that is stable across renders.
 * The sampler returns 0 until the WASM module has loaded.
 *
 * Example – drive rain variation from WASM noise:
 *   const noise = useNoiseFunction();
 *   const variation = noise(time * 0.1, longitude * 0.01); // [-1, 1]
 */
export function useNoiseFunction(): (x: number, y: number) => number {
  const { wasm } = useWasmModule();

  return useCallback(
    (x: number, y: number): number => {
      if (!wasm) return 0;
      return wasm.noise2d(x, y);
    },
    [wasm],
  );
}
