/**
 * src/wasm/abi.ts
 * The public TypeScript contract for the streetview-wasm module — one method
 * per WASM export. Implemented by both the compiled binary (the marshalling
 * wrappers built in src/wasm/index.ts) and the pure-JS fallback
 * (src/wasm/jsFallback.ts). Keeping the interface in its own file means the
 * ABI shape can be read/reviewed without wading through either
 * implementation.
 */
import type { LumaReduce } from '../renderer/gpuChores/lumaMath';

export type { LumaReduce };

/** All functions exposed by the streetview-wasm module. */
export interface StreetViewWasmAPI {
  /**
   * Seed the internal permutation table.
   * Call once before using noise functions.  Any non-zero integer works.
   */
  seed(seed: number): void;

  /**
   * 2-D gradient (Perlin-style) noise.
   * @returns Value in [-1, 1].
   */
  noise2d(x: number, y: number): number;

  /**
   * Fill a Float32Array with 2-D noise values.
   * The array must have `width * height` elements.
   *
   * @param out     Pre-allocated Float32Array to fill.
   * @param width   Number of columns.
   * @param height  Number of rows.
   * @param scale   Spatial frequency (larger = lower frequency pattern).
   * @param offsetX World-space X offset.
   * @param offsetY World-space Y offset.
   */
  fillNoiseBuffer(
    out: Float32Array,
    width: number,
    height: number,
    scale: number,
    offsetX: number,
    offsetY: number,
  ): void;

  /**
   * Fractal Brownian motion over {@link noise2d}.
   *
   * @param octaves    Octaves to sum (<= 0 returns 0).
   * @param lacunarity Frequency multiplier per octave (2 is the usual value).
   * @param gain       Amplitude multiplier per octave (0.5 is the usual value).
   * @returns Value in [-1, 1] — normalised by the accumulated amplitude so the
   *          range does not depend on the octave count.
   */
  fbm2d(x: number, y: number, octaves: number, lacunarity: number, gain: number): number;

  /**
   * Fill a Float32Array with fBm samples. Same tile layout as
   * {@link fillNoiseBuffer}; each sample is an fBm stack instead of one octave.
   */
  fillFbmBuffer(
    out: Float32Array,
    width: number,
    height: number,
    scale: number,
    offsetX: number,
    offsetY: number,
    octaves: number,
    lacunarity: number,
    gain: number,
  ): void;

  /**
   * Fill a Float32Array with deterministic particle spawn seeds — 4 floats per
   * particle: x [0,1), y [0,1), speed [0.5,1.5), phase [0, 2π).
   * The array must have `count * 4` elements.
   */
  fillParticleSeeds(out: Float32Array, count: number, seed: number): void;

  /**
   * Haversine great-circle distance between two WGS-84 coordinates.
   * @returns Distance in metres.
   */
  haversine(lat1: number, lon1: number, lat2: number, lon2: number): number;

  /**
   * Haversine distance for a whole polyline in one call — one WASM boundary
   * crossing instead of one per segment.
   *
   * @param points       `count * 2` doubles: lat, lon, lat, lon, …
   * @param segmentsOut  Receives the `count - 1` per-segment distances in
   *                     metres. Must have at least `count - 1` elements;
   *                     untouched when fewer than two points are supplied.
   * @returns Total distance in metres (0 for fewer than two points).
   */
  batchHaversine(points: Float64Array, segmentsOut: Float64Array): number;

  /** Normalise an angle to [0, 360). */
  normalizeAngle(angle: number): number;

  /** Smallest signed angle difference; result in `[-180, 180)` — exactly-opposite inputs give -180. */
  signedAngleDiff(from: number, to: number): number;

  /**
   * Fill a Float32Array with mono engine+road PCM in [-1, 1].
   * `out` must have at least `count` elements.
   */
  fillEngineNoise(
    out: Float32Array,
    count: number,
    rpm: number,
    load: number,
    speedKmh: number,
    timeSec: number,
    sampleRate: number,
  ): void;

  /**
   * Fill a Float32Array with a short cabin impulse response — tap 0 is the
   * direct path, then early reflections and a damped diffuse tail, normalised
   * to a DC gain of 1 so convolving with it does not change the bed's level.
   *
   * @param out         Pre-allocated array of at least `count` taps.
   * @param count       Number of taps (128 is what the cabin worklet uses).
   * @param vehicleType Cabin profile index, clamped to [0, 4] — see
   *                    `CABIN_IR_VEHICLE_INDEX` in `src/car/audio/cabinIr.ts`.
   * @param openness    0 = sealed, 1 = roof/windows open (more HF gets through).
   * @param sampleRate  Audio sample rate (Hz); values <= 1 fall back to 44100.
   */
  fillCabinIr(
    out: Float32Array,
    count: number,
    vehicleType: number,
    openness: number,
    sampleRate: number,
  ): void;

  /**
   * Fill a pair of short per-ear impulse responses that model a heading-
   * relative binaural shadow (interaural time + level difference) — an
   * analytic directional model, not a measured HRTF. Both arrays get `count`
   * taps; azimuth 0 leaves them identical (centered, no filtering).
   *
   * @param left        Pre-allocated array of at least `count` taps (left ear).
   * @param right       Pre-allocated array of at least `count` taps (right ear).
   * @param count       Number of taps per ear.
   * @param azimuthDeg  Signed angle of the source relative to forward, clamped
   *                    to [-90, 90]. Positive = toward the right ear.
   * @param sampleRate  Audio sample rate (Hz); values <= 1 fall back to 44100.
   */
  fillHrtf(
    left: Float32Array,
    right: Float32Array,
    count: number,
    azimuthDeg: number,
    sampleRate: number,
  ): void;

  /**
   * 256-bin Rec.709 luma histogram of packed RGBA8.
   * `rgba` must contain at least `width * height * 4` bytes.
   */
  lumaHistogramBt709(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): Uint32Array;

  /** Rec.709 luma reduce: mean / min / max in [0, 1]. */
  reduceLumaBt709(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): LumaReduce;

  /** Integer box-filter downsample of packed RGBA8. */
  downsample2d(
    src: Uint8Array | Uint8ClampedArray,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
  ): Uint8Array;

  /** True when backed by the compiled WASM binary; false for JS fallback. */
  isWasm: boolean;
}
