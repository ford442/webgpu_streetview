/**
 * src/renderer/weatherNoiseTile.ts
 * The 64² dust-turbulence tile both weather paths sample (fragment binding 3,
 * compute binding 12 as 1024 vec4s), and the feeder that refreshes it.
 *
 * Plain TypeScript since #341: a 64² tile every 30 frames is one-line maths,
 * not a kernel, and the frame loop should not need the WASM binary to draw
 * dust. It is the classic Perlin of `cpp/src/noise_module.cpp` (`sw_seed`,
 * `sw_noise2d`, `sw_fbm2d`, `sw_fill_*_buffer`) with every operation rounded
 * to f32 (`Math.fround`), so the tile is bit-identical to the WASM
 * `fillNoiseBuffer` / `fillFbmBuffer` output it replaces — the look does not
 * move, and `weatherNoiseTile.test.ts` holds the two to exact equality against
 * the committed binary. A single f32 op computed in f64 and rounded once is
 * the correctly rounded f32 result (53 ≥ 2·24 + 2), and the C++ builds with
 * `-ffp-contract=off`, so there is no FMA to mirror.
 *
 * Usage (see src/components/WebGPUCanvas.tsx / renderer/frameDriver.ts):
 *   const feeder = new NoiseTileFeeder();
 *   feeder.setDetail(mode === 'compute' ? 'fbm' : 'classic');
 *   // every frame:
 *   const tile = feeder.sampleTile(frameCount, time);
 *   if (tile) renderer.updateNoiseBuffer(tile);
 */

import { readFlag } from '../config/flags';

/** Noise tile is square; matches the WGSL storage buffer array length in weather-post.wgsl. */
export const NOISE_TILE_SIZE = 64;

/** Refresh the tile this often (in frames) — cheap enough to not affect frame time, coarse enough to feel like drifting CPU turbulence rather than per-pixel GPU noise. */
export const NOISE_UPDATE_INTERVAL_FRAMES = 30;

/** Spatial frequency of the dust turbulence tile (both detail modes). */
export const NOISE_TILE_SCALE = 12;

/** Permutation seed (the WASM feeder called `seed(1)` once at load). */
export const NOISE_TILE_SEED = 1;

/**
 * Tile detail level.
 *
 * `'classic'` is the single-octave Perlin tile the fragment weather path has
 * always been fed — it stays the default so `?weather=fragment` output is
 * unchanged.  `'fbm'` stacks octaves for turbulence with visible structure at
 * several scales; the compute path opts into it because that pipeline exists
 * to carry the richer effects.
 */
export type NoiseTileDetail = 'classic' | 'fbm';

/** fBm parameters for the `'fbm'` detail mode. */
export const FBM_TILE_OCTAVES = 4;
export const FBM_TILE_LACUNARITY = 2.0;
export const FBM_TILE_GAIN = 0.5;

/**
 * Dev toggle for the noise-tile dust effect: `?wasmNoise=off` (or a stored
 * `streetview.wasmNoise=off` preference) disables it, reverting the ambient
 * dust effect to fully off for an easy A/B. Defaults to enabled. The flag
 * keeps its pre-#341 name so existing links still work.
 */
export function getNoiseTilePreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const explicit = readFlag('wasmNoise');
    if (explicit !== undefined) return explicit;

    const stored = window.localStorage.getItem('streetview.wasmNoise');
    if (stored === 'off') return false;
  } catch {
    // Storage/URL access may be unavailable in hardened browsers.
  }
  return true;
}

// ---------------------------------------------------------------------------
// Perlin (mirror of cpp/src/noise_module.cpp, f32 throughout)
// ---------------------------------------------------------------------------

const f32 = Math.fround;
const SQRT2_INV = f32(0.70710678);
/** grad2[8][2] from the C++, flattened. */
const GRAD2 = new Float64Array([
  1, 0, -1, 0, 0, 1, 0, -1,
  SQRT2_INV, SQRT2_INV, -SQRT2_INV, SQRT2_INV, SQRT2_INV, -SQRT2_INV, -SQRT2_INV, -SQRT2_INV,
]);

/**
 * The 512-entry permutation table `sw_seed` builds: an LCG-driven
 * Fisher–Yates shuffle of 0..255, duplicated for wrap-around.
 */
export function perlinPermutation(seed: number): Uint8Array {
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let state = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = ((state >>> 16) & 0x7fff) % (i + 1);
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  perm.copyWithin(256, 0, 256);
  return perm;
}

/** 6t^5 - 15t^4 + 10t^3, in the C++'s operation order. */
function fade(t: number): number {
  const t3 = f32(f32(t * t) * t);
  return f32(t3 * f32(f32(t * f32(f32(t * 6) - 15)) + 10));
}

function lerp(a: number, b: number, t: number): number {
  return f32(a + f32(t * f32(b - a)));
}

function grad2d(hash: number, x: number, y: number): number {
  const g = (hash & 7) * 2;
  return f32(f32(GRAD2[g]! * x) + f32(GRAD2[g + 1]! * y));
}

/** `sw_noise2d` for f32 inputs. Value in [-1, 1]. */
export function perlinNoise2d(perm: Uint8Array, x: number, y: number): number {
  const flx = Math.floor(x);
  const fly = Math.floor(y);
  // The C++ takes the low byte of the int lattice index and 0 outside int's
  // range; ToInt32 gives the same low byte (every float that large is a
  // multiple of 256, and NaN / ±Infinity map to 0).
  const X = flx & 255;
  const Y = fly & 255;
  const fx = f32(x - flx);
  const fy = f32(y - fly);
  const u = fade(fx);
  const v = fade(fy);
  const fx1 = f32(fx - 1);
  const fy1 = f32(fy - 1);

  const n00 = grad2d(perm[perm[X]! + Y]!, fx, fy);
  const n10 = grad2d(perm[perm[X + 1]! + Y]!, fx1, fy);
  const n01 = grad2d(perm[perm[X]! + Y + 1]!, fx, fy1);
  const n11 = grad2d(perm[perm[X + 1]! + Y + 1]!, fx1, fy1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/**
 * Fill a row-major `width × height` tile, sample (col, row) at
 * `((col + offsetX) / scale, (row + offsetY) / scale)` — `sw_fill_noise_buffer`
 * (`fbm` omitted) or `sw_fill_fbm_buffer` (`sw_fbm2d`: octaves summed and
 * normalised by the accumulated amplitude). Scalar arguments cross into f32
 * the way the WASM call boundary converted them.
 */
export function fillNoiseTile(
  out: Float32Array,
  perm: Uint8Array,
  width: number,
  height: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  fbm?: { octaves: number; lacunarity: number; gain: number },
): void {
  if (width <= 0 || height <= 0) return;
  const invScale = f32(1 / f32(scale));
  const ox = f32(offsetX);
  const oy = f32(offsetY);
  if (!fbm) {
    for (let row = 0; row < height; row++) {
      const ny = f32(f32(row + oy) * invScale);
      for (let col = 0; col < width; col++) {
        out[row * width + col] = perlinNoise2d(perm, f32(f32(col + ox) * invScale), ny);
      }
    }
    return;
  }
  // Octave frequencies and amplitudes do not depend on the sample: build them
  // once (the same f32 recurrences as sw_fbm2d) instead of per texel.
  const octaves = Math.max(0, fbm.octaves | 0);
  const lacunarity = f32(fbm.lacunarity);
  const gain = f32(fbm.gain);
  const freqs = new Float64Array(octaves);
  const amps = new Float64Array(octaves);
  let norm = 0;
  for (let o = 0, amp = 1, freq = 1; o < octaves; o++) {
    freqs[o] = freq;
    amps[o] = amp;
    norm = f32(norm + amp);
    amp = f32(amp * gain);
    freq = f32(freq * lacunarity);
  }
  for (let row = 0; row < height; row++) {
    const ny = f32(f32(row + oy) * invScale);
    for (let col = 0; col < width; col++) {
      const nx = f32(f32(col + ox) * invScale);
      let sum = 0;
      for (let o = 0; o < octaves; o++) {
        const freq = freqs[o]!;
        sum = f32(sum + f32(amps[o]! * perlinNoise2d(perm, f32(nx * freq), f32(ny * freq))));
      }
      out[row * width + col] = norm > 0 ? f32(sum / norm) : 0;
    }
  }
}

const FBM_TILE_PARAMS = {
  octaves: FBM_TILE_OCTAVES,
  lacunarity: FBM_TILE_LACUNARITY,
  gain: FBM_TILE_GAIN,
} as const;

export class NoiseTileFeeder {
  private readonly perm = perlinPermutation(NOISE_TILE_SEED);
  private readonly buffer = new Float32Array(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
  private detail: NoiseTileDetail = 'classic';

  constructor(detail: NoiseTileDetail = 'classic') {
    this.detail = detail;
  }

  /**
   * Switch detail level. Safe to call every frame — the next tile refresh picks
   * the new mode up. Callers set `'fbm'` once the renderer reports the compute
   * weather path (see WebGPUCanvas).
   */
  public setDetail(detail: NoiseTileDetail): void {
    this.detail = detail;
  }

  public getDetail(): NoiseTileDetail {
    return this.detail;
  }

  /**
   * Returns a freshly-filled tile when `frameCount` lands on the update
   * cadence, otherwise null (caller should skip the GPU buffer upload).
   * The same buffer instance every time — no per-frame allocation.
   */
  public sampleTile(frameCount: number, time: number): Float32Array<ArrayBuffer> | null {
    if (frameCount % NOISE_UPDATE_INTERVAL_FRAMES !== 0) return null;
    fillNoiseTile(
      this.buffer,
      this.perm,
      NOISE_TILE_SIZE,
      NOISE_TILE_SIZE,
      NOISE_TILE_SCALE,
      time * 2.0,
      0,
      this.detail === 'fbm' ? FBM_TILE_PARAMS : undefined,
    );
    return this.buffer;
  }
}
