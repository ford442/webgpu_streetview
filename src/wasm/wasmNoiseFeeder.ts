/**
 * src/wasm/wasmNoiseFeeder.ts
 * Bridges the WASM Perlin noise module into the WebGPU render loop.
 *
 * Usage (see src/components/WebGPUCanvas.tsx):
 *   const feeder = new WasmNoiseFeeder();
 *   feeder.ensureLoaded();
 *   // every frame:
 *   const tile = feeder.sampleTile(frameCount, time);
 *   if (tile) renderer.updateNoiseBuffer(tile);
 */

import { loadWasmModule, type StreetViewWasmAPI } from './index';

/** Noise tile is square; matches the WGSL storage buffer array length in weather-post.wgsl. */
export const NOISE_TILE_SIZE = 64;

/** Refresh the tile this often (in frames) — cheap enough to not affect frame time, coarse enough to feel like drifting CPU turbulence rather than per-pixel GPU noise. */
export const NOISE_UPDATE_INTERVAL_FRAMES = 30;

/**
 * Dev toggle for the WASM-driven noise effect: `?wasmNoise=off` (or a stored
 * `streetview.wasmNoise=off` preference) disables it, reverting the ambient
 * dust effect to fully off so the WASM-vs-no-WASM visual difference is easy
 * to A/B compare. Defaults to enabled.
 */
export function getWasmNoisePreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get('wasmNoise');
    if (explicit === 'off') return false;
    if (explicit === 'on') return true;

    const stored = window.localStorage.getItem('streetview.wasmNoise');
    if (stored === 'off') return false;
  } catch {
    // Storage/URL access may be unavailable in hardened browsers.
  }
  return true;
}

export class WasmNoiseFeeder {
  private wasm: StreetViewWasmAPI | null = null;
  private loading: Promise<void> | null = null;
  private readonly buffer = new Float32Array(NOISE_TILE_SIZE * NOISE_TILE_SIZE);

  /** Kick off (or continue) loading the WASM module. Safe to call every frame. */
  public ensureLoaded(): void {
    if (this.wasm || this.loading) return;
    this.loading = loadWasmModule().then((mod) => {
      mod.seed(1);
      this.wasm = mod;
    });
  }

  public get isReady(): boolean {
    return this.wasm !== null;
  }

  /** Resolves once the module has finished loading (WASM or JS fallback). Mainly for tests/warmup. */
  public async waitUntilLoaded(): Promise<void> {
    this.ensureLoaded();
    await this.loading;
  }

  /** True when backed by the compiled WASM binary; false for the JS fallback. */
  public get isWasm(): boolean {
    return this.wasm?.isWasm ?? false;
  }

  /**
   * Returns a freshly-filled tile when `frameCount` lands on the update
   * cadence, otherwise null (caller should skip the GPU buffer upload).
   * Triggers the (idempotent) module load as a side effect so the first
   * caller doesn't need a separate bootstrap step.
   */
  public sampleTile(frameCount: number, time: number): Float32Array | null {
    this.ensureLoaded();
    if (!this.wasm) return null;
    if (frameCount % NOISE_UPDATE_INTERVAL_FRAMES !== 0) return null;

    this.wasm.fillNoiseBuffer(this.buffer, NOISE_TILE_SIZE, NOISE_TILE_SIZE, 12, time * 2.0, 0);
    return this.buffer;
  }
}
