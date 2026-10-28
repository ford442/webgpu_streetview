/**
 * src/wasm/abi.ts
 * The public TypeScript contract for the streetview-wasm module — one method
 * per WASM export, implemented by the marshalling wrappers src/wasm/index.ts
 * builds around the compiled binary (the only implementation). Keeping the
 * interface in its own file means the ABI shape can be read/reviewed without
 * wading through the loader.
 */
import type { LumaReduce } from '../renderer/gpuChores/lumaMath';

export type { LumaReduce };

/** {@link StreetViewWasmAPI.lumaAnalyze} output: the histogram plus an exact reduce. */
export interface LumaAnalysis extends LumaReduce {
  bins: Uint32Array;
}

/**
 * A directed link graph in CSR form — the shape `graph_astar` reads. Node
 * `i`'s outgoing edges are `neighbors[offsets[i] .. offsets[i + 1])`;
 * `coords` holds `nodeCount` [lat, lng] pairs. Built from a prefetched
 * `RouteGraphNode[]` by `src/wasm/graph.ts`.
 */
export interface CsrGraph {
  nodeCount: number;
  offsets: Int32Array;
  neighbors: Int32Array;
  coords: Float64Array;
}

/**
 * Carried between scene-depth inferences ({@link StreetViewWasmAPI.depthNormalize});
 * reset when the scene or view changes.
 */
export interface DepthNormalizeState {
  lo: number;
  hi: number;
  /** Proxy-scale depth of the nearest disparity (`q` in `depth = q / n`). */
  nearDepth: number;
  /** Last normalised map, for the per-texel EMA when the next one is aligned with it. */
  previous: Float32Array | null;
}

export interface DepthNormalizeOptions {
  /** Same pano and same view as the previous map: blend texel-wise. */
  aligned: boolean;
  /** Same pano (any view): blend the range and scale, so the map does not pump. */
  sameScene: boolean;
  width: number;
  height: number;
  /** Top-origin screen Y of the pitch horizon the map was inferred at. */
  horizonY: number;
}

/**
 * Targets for the cabin engine (`dsp_set_params`). The engine glides to them
 * with a ~40 ms one-pole per parameter, smoothed per sample, so they can be
 * posted at any cadence. Out-of-range values clamp.
 */
export interface CabinDspParams {
  /** Engine RPM [0, 12000]. */
  rpm: number;
  /** Throttle/load [0, 1]. */
  load: number;
  /** Road speed in m/s [0, 120]; 40 m/s is full road and wind noise. */
  speedMps: number;
  /** 0 = sealed, 1 = roof/windows open. */
  openness: number;
  /** Voicing index in `CABIN_IR_VEHICLE_INDEX` order, clamped [0, 4]. */
  vehicle: number;
  /** 0 = dry, 1 = soaked: tyre hiss and arch spray. */
  wetRoad: number;
  /** Rain on the roof [0, 1]. */
  rain: number;
  /** Ambient wind in m/s [0, 60]. */
  windMps: number;
  /** Radio level into the cabin [0, 2]. */
  radioGain: number;
  /** Wipers running (they thump while rain > 0.02). Non-zero numbers count as on. */
  wipers: boolean | number;
}

/**
 * One cabin engine instance (`dsp_*`): engine, road, wind, rain, wiper and
 * radio, placed by the head-shadow model and run through the cabin FIR.
 * Production runs the WASM build of this inside the AudioWorklet
 * (src/car/audio/cabinWorkletSource.ts); this interface is the same engine on
 * the main thread, for tests and tooling.
 */
export interface CabinDsp {
  setParams(params: CabinDspParams): void;
  /**
   * Replace the cabin IR (`count` taps, default `taps.length`; more than
   * `dsp_max_ir_taps()` truncates; null is the identity). Crossfades over
   * 256 samples.
   */
  setIr(taps: Float32Array | null, count?: number): void;
  /**
   * Render `frames` stereo samples. Null radio inputs are silence; null
   * outputs are discarded. Output is clamped to [-1, 1].
   */
  render(
    radioL: Float32Array | null,
    radioR: Float32Array | null,
    outL: Float32Array | null,
    outR: Float32Array | null,
    frames: number,
  ): void;
  /** Free the instance (WASM heap); the object must not be used afterwards. */
  destroy(): void;
}

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
   * Haversine distance for a whole polyline in one call — one WASM boundary
   * crossing instead of one per segment. A single pair is the f64 TS
   * `haversineMeters` (src/utils/navigation.ts), the same formula.
   *
   * @param points       `count * 2` doubles: lat, lon, lat, lon, …
   * @param segmentsOut  Receives the `count - 1` per-segment distances in
   *                     metres. Must have at least `count - 1` elements;
   *                     untouched when fewer than two points are supplied.
   * @returns Total distance in metres (0 for fewer than two points).
   */
  batchHaversine(points: Float64Array, segmentsOut: Float64Array): number;

  /**
   * Destination point from a WGS-84 start, a distance in metres and an initial
   * bearing (0 = north, clockwise) — the spherical direct geodetic problem.
   *
   * The only copy of this formula in the app: `src/utils/historicalImagery.ts`
   * builds its sample ring with it instead of re-deriving `asin`/`atan2` in
   * TypeScript.
   *
   * @returns Degrees. Longitude is not re-wrapped to [-180, 180].
   */
  offsetLatLng(
    lat: number,
    lng: number,
    distanceMeters: number,
    bearingDeg: number,
  ): { lat: number; lng: number };

  /**
   * Initial great-circle bearing (forward azimuth) from point 1 to point 2.
   * @returns Degrees in [0, 360), 0 = north, clockwise. Identical points give 0.
   */
  initialBearing(lat1: number, lng1: number, lat2: number, lng2: number): number;

  /**
   * Resample a polyline to points evenly spaced along its great-circle length
   * (first and last points kept; spacing carried across vertices; longitudes
   * wrapped to [-180, 180)).
   *
   * @param points  `n * 2` doubles: lat, lng, lat, lng, …
   * @param stepMeters  Spacing; <= 0 or non-finite copies the input through.
   * @returns A new `count * 2` array of resampled [lat, lng] pairs.
   */
  polylineResample(points: Float64Array, stepMeters: number): Float64Array;

  /**
   * Project a point onto a polyline — "where am I on the route, how far off it".
   * The closest segment wins (ties: the earlier one); a projection past an end
   * of its segment clamps to that vertex.
   *
   * @param points  `n * 2` doubles: lat, lng, lat, lng, …
   * @returns `segment` index (-1 for an empty polyline), `alongMeters` from the
   *          route start, signed `crossMeters` (+ = right of travel).
   */
  polylineProject(
    points: Float64Array,
    lat: number,
    lng: number,
  ): { segment: number; alongMeters: number; crossMeters: number };

  /**
   * Fill a Float32Array with mono engine+road PCM in [-1, 1].
   * `out` must have at least `count` elements.
   *
   * Streaming: feed the returned phase back in as `phase` for the next block
   * and advance `sampleIndex` by `count`. The oscillator phase is carried in
   * f64 and wrapped every sample, so the tone at hour two is the tone at
   * second one (the old f32 `timeSec` ABI turned into a staircase).
   *
   * @param phase        Oscillator phase at sample 0, in fundamental cycles;
   *                     wrapped into [0, 1) (non-finite -> 0).
   * @param sampleIndex  Absolute stream position of sample 0 (integer sample
   *                     count). Road noise hashes it per sample, so output is
   *                     independent of block size.
   * @returns Phase after the last sample, in [0, 1).
   */
  fillEngineNoise(
    out: Float32Array,
    count: number,
    rpm: number,
    load: number,
    speedKmh: number,
    phase: number,
    sampleIndex: number,
    sampleRate: number,
  ): number;

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

  /**
   * Fused luma chore: box-downsample onto `dstW x dstH` (pass the source size
   * to analyse as-is), histogram and reduce in one pass with one copy-in.
   * `bins` equals {@link downsample2d} then {@link lumaHistogramBt709}; the
   * mean/min/max come from integer luma (2126 r + 7152 g + 722 b) summed
   * exactly, so a flat frame's mean is its colour's luma.
   */
  lumaAnalyze(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    dstW: number,
    dstH: number,
  ): LumaAnalysis;

  /**
   * A new cabin engine at `sampleRate` (<= 1 falls back to 44100). Null when
   * the WASM heap cannot allocate one.
   */
  createCabinDsp(sampleRate: number): CabinDsp | null;

  /** `[lo, hi]` disparity at the given percentiles (0-1) of a strided subsample. */
  depthPercentiles(disparity: Float32Array, lowPct: number, highPct: number): [number, number];

  /** Proxy-scale depth of the nearest disparity, calibrated on the ground band. */
  depthNearDepth(nearness: Float32Array, width: number, height: number, horizonY: number): number;

  /**
   * Relative inverse depth → the `viewDepthProxy` scale, eased across
   * inferences through `state` (updated in place; `state.previous` becomes `out`).
   */
  depthNormalize(
    disparity: Float32Array,
    state: DepthNormalizeState,
    options: DepthNormalizeOptions,
    out: Float32Array,
  ): Float32Array;

  /** Integer box-filter downsample of packed RGBA8. */
  downsample2d(
    src: Uint8Array | Uint8ClampedArray,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
  ): Uint8Array;
  /**
   * Shortest path (A*, haversine edge cost and heuristic) from node `from` to
   * node `to`. Ties break on the lower node index, so the path is identical on
   * every backend.
   * @returns Node indices `from` … `to` (just `[from]` when they are equal), or
   *          null when `to` is unreachable or the graph is malformed.
   */
  graphAstar(graph: CsrGraph, from: number, to: number): Int32Array | null;

  /** Index of the node nearest to [lat, lng] (ties: the lower index); -1 when empty. */
  graphNearest(graph: CsrGraph, lat: number, lng: number): number;
}
