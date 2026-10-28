/**
 * src/renderer/weatherParticleSeeds.ts
 * Spawn seeds for the compute weather path's GPU precipitation field
 * (`weather-particles.wgsl`, bindings 7/8).
 *
 * Seeds are generated once (and again when the particle count changes, or
 * when precipitation returns after a dry spell). Per-frame motion is GPU
 * compute — this feeder never integrates on the JS thread.
 *
 * Plain TypeScript since #341 (a few thousand LCG steps, once): the same LCG
 * and layout as `sw_fill_particle_seeds` in cpp/src/noise_module.cpp, and
 * bit-identical to it without any f32 emulation — each value is a 24-bit
 * fraction, `0.5 + u` and `u * f32(2π)` are exact in f64, and the store into
 * the Float32Array is then the one rounding the f32 op would have made.
 *
 * Usage (see src/components/WebGPUCanvas.tsx / renderer/frameDriver.ts):
 *   const feeder = new ParticleSeedFeeder();
 *   const seeds = feeder.sampleSeeds(count, precipActive, PARTICLE_SEED);
 *   if (seeds) renderer.updateParticleSeeds(seeds, gridW, gridH);
 */

import { readFlag } from '../config/flags';

/**
 * Dev toggle: `?wasmParticles=off` (or stored `streetview.wasmParticles=off`)
 * disables the GPU particle field so the procedural compute rain/snow is easy
 * to A/B. Defaults to enabled. `?wasmNoise=off` does **not** kill particles —
 * they are a separate feed. The flag keeps its pre-#341 name.
 */
export function getParticleSeedPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const explicit = readFlag('wasmParticles');
    if (explicit !== undefined) return explicit;

    const stored = window.localStorage.getItem('streetview.wasmParticles');
    if (stored === 'off') return false;
  } catch {
    // Storage/URL access may be unavailable in hardened browsers.
  }
  return true;
}

const TWO_PI_F32 = Math.fround(6.2831853);

/**
 * Deterministic spawn seeds, 4 floats per particle: x [0,1), y [0,1),
 * speed [0.5,1.5), phase [0, 2π). Writes `min(count, out.length / 4)` particles.
 */
export function fillParticleSeeds(out: Float32Array, count: number, seed: number): void {
  const n = Math.min(count, Math.floor(out.length / 4));
  let state = seed >>> 0;
  const nextUnit = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return ((state >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = nextUnit();
    out[o + 1] = nextUnit();
    out[o + 2] = 0.5 + nextUnit();
    out[o + 3] = nextUnit() * TWO_PI_F32;
  }
}

export class ParticleSeedFeeder {
  private buffer: Float32Array<ArrayBuffer> = new Float32Array(0);
  private lastCount = -1;
  private lastPrecipActive = false;

  /**
   * Returns a freshly filled seed buffer when the count changed or
   * precipitation restarted; otherwise null so the caller can skip the GPU
   * upload.
   *
   * `precipActive` is rain+snow above epsilon — going dry→wet reseeds so
   * the field does not resume from a stale wrap. Slider nudges while wet
   * do **not** reseed (that would pop flakes).
   */
  public sampleSeeds(
    count: number,
    precipActive: boolean,
    seed: number,
  ): Float32Array<ArrayBuffer> | null {
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
    fillParticleSeeds(this.buffer, count, seed);
    this.lastCount = count;
    return this.buffer;
  }
}
