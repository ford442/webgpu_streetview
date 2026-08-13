/**
 * src/wasm/wasmParticleFeeder.ts
 * Bridges WASM `fill_particle_seeds` into the compute weather path.
 *
 * Seeds are generated once (and again when the particle count changes, or
 * when precipitation returns after a dry spell). Per-frame motion is GPU
 * compute — this feeder never integrates on the JS thread.
 *
 * Usage (see src/components/WebGPUCanvas.tsx):
 *   const feeder = new WasmParticleFeeder();
 *   feeder.ensureLoaded();
 *   const seeds = feeder.sampleSeeds(count);
 *   if (seeds) renderer.updateParticleSeeds(seeds, gridW, gridH);
 */

import { loadWasmModule, type StreetViewWasmAPI } from './index';

/**
 * Dev toggle: `?wasmParticles=off` (or stored `streetview.wasmParticles=off`)
 * disables the GPU particle field so the procedural compute rain/snow is easy
 * to A/B. Defaults to enabled. `?wasmNoise=off` does **not** kill particles —
 * they are a separate feed.
 */
export function getWasmParticlePreference(): boolean {
    if (typeof window === 'undefined') return true;
    try {
        const params = new URLSearchParams(window.location.search);
        const explicit = params.get('wasmParticles');
        if (explicit === 'off') return false;
        if (explicit === 'on') return true;

        const stored = window.localStorage.getItem('streetview.wasmParticles');
        if (stored === 'off') return false;
    } catch {
        // Storage/URL access may be unavailable in hardened browsers.
    }
    return true;
}

export class WasmParticleFeeder {
    private wasm: StreetViewWasmAPI | null = null;
    private loading: Promise<void> | null = null;
    private buffer: Float32Array = new Float32Array(0);
    private lastCount = -1;
    private lastPrecipActive = false;

    /** Kick off (or continue) loading the WASM module. Safe to call every frame. */
    public ensureLoaded(): void {
        if (this.wasm || this.loading) return;
        this.loading = loadWasmModule().then((mod) => {
            this.wasm = mod;
        });
    }

    public get isReady(): boolean {
        return this.wasm !== null;
    }

    /** Resolves once the module has finished loading (WASM or JS fallback). */
    public async waitUntilLoaded(): Promise<void> {
        this.ensureLoaded();
        await this.loading;
    }

    /** True when backed by the compiled WASM binary; false for the JS fallback. */
    public get isWasm(): boolean {
        return this.wasm?.isWasm ?? false;
    }

    /**
     * Returns a freshly filled seed buffer (4 floats/particle: x, y, speed,
     * phase) when the count changed or precipitation restarted; otherwise
     * null so the caller can skip the GPU upload.
     *
     * `precipActive` is rain+snow above epsilon — going dry→wet reseeds so
     * the field does not resume from a stale wrap. Slider nudges while wet
     * do **not** reseed (that would pop flakes).
     */
    public sampleSeeds(
        count: number,
        precipActive: boolean,
        seed: number,
    ): Float32Array | null {
        this.ensureLoaded();
        if (!this.wasm) return null;
        if (count <= 0) return null;

        const countChanged = count !== this.lastCount;
        const restarted = precipActive && !this.lastPrecipActive;
        this.lastPrecipActive = precipActive;
        if (!countChanged && !restarted && this.buffer.length === count * 4) {
            return null;
        }

        if (this.buffer.length !== count * 4) {
            this.buffer = new Float32Array(count * 4);
        }
        this.wasm.fillParticleSeeds(this.buffer, count, seed);
        this.lastCount = count;
        return this.buffer;
    }
}
