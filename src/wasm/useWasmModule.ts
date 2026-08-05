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
 * @remarks `useWasmModule` backs the tour route-length labels in
 * src/components/TourPanel.tsx (via src/utils/routeStats.ts).  The render-loop
 * integration does not go through React at all — WasmNoiseFeeder
 * (src/wasm/wasmNoiseFeeder.ts) is driven imperatively from WebGPUCanvas.tsx.
 */

import { useState, useEffect } from 'react';
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
