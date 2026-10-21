/**
 * The WASM numeric layer as a renderer boot step. Its own module (not
 * `bootDevice.ts`) so suites that replace the device boot wholesale keep the
 * real loader, which src/setupTests.ts has already filled.
 */
import { loadWasmModule, type StreetViewWasmAPI } from '../wasm';

/** The numeric layer did not load; `Renderer.init` publishes it as stage `wasm`. */
export class WasmLoadError extends Error {
    constructor(cause: unknown) {
        super(`streetview-wasm failed to load: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = 'WasmLoadError';
    }
}

/**
 * The WASM numeric layer, as a boot step. `Renderer.init` starts it before
 * `bootDevice` and awaits it beside the pass shader fetches: the binary is the
 * only implementation of every kernel, so a failed fetch is as fatal as a
 * failed required shader. Resolves at once when src/index.tsx already loaded it.
 */
export function loadBootWasm(): Promise<StreetViewWasmAPI> {
    return loadWasmModule().catch((error: unknown) => {
        throw new WasmLoadError(error);
    });
}
