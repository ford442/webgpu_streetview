/**
 * src/wasm/audioKernels.ts
 * JS twin of cpp/include/audio_kernels.h — the unexported building blocks the
 * audio domains share (the sample hash, the engine tone, the head-shadow
 * coefficients). jsFallback.ts and cabinDspTwin.ts both use these, the way
 * audio_module.cpp, hrtf_module.cpp and cabin_dsp_module.cpp share the header,
 * so the twins cannot drift apart from each other either.
 *
 * Bit-exact with the C++: every f32 expression is rounded after each op with
 * `Math.fround` (one f64 op on two f32 values, then fround, is a correctly
 * rounded f32 op), and f32 constants are pre-rounded.
 */

const f = Math.fround;

/** Twin of `sv_audio::hash_u32` (lowbias32). */
export function hashU32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Twin of `sv_audio::hash_unit`: top 24 bits as [0, 1), exact in f32. */
export function hashUnit(h: number): number {
  return ((h >>> 8) & 0xffffff) / 16777216;
}

const F_0_28 = f(0.28);
const F_0_11 = f(0.11);

/** Twin of `sv_audio::engine_tone`; `phase` is f64, `loadGain` f32. */
export function engineTone(phase: number, loadGain: number): number {
  const cycles2 = phase * 2;
  const frac2 = cycles2 - Math.floor(cycles2);
  const saw = f(f(phase) * 2 - 1);
  const saw2 = f(f(frac2) * 2 - 1);
  return f(f(f(saw * F_0_28) + f(saw2 * F_0_11)) * loadGain);
}

/** Mirrors `kMaxItdSeconds`. */
const MAX_ITD_SECONDS = f(6.6e-4);
/** Mirrors `kMaxFarGainCut`. */
const MAX_FAR_GAIN_CUT = f(0.35);
/** Mirrors `(1.0f - kFarEarDampFloor)`. */
const DAMP_RANGE = f(1 - f(0.28));

export interface HrtfShadow {
  delay: number;
  farGain: number;
  damp: number;
  rightIsNear: boolean;
}

/** Twin of `sv_audio::hrtf_shadow`; `sampleRate` must already be sanitised. */
export function hrtfShadow(azimuthDeg: number, sampleRate: number): HrtfShadow {
  let az = f(azimuthDeg);
  if (az > 90) az = 90;
  else if (az < -90) az = -90;
  const ratio = f(az / 90);
  const absRatio = Math.abs(ratio);
  const shaped = f(ratio * f(2 - absRatio));
  const absShaped = Math.abs(shaped);
  return {
    delay: Math.trunc(f(f(f(MAX_ITD_SECONDS * sampleRate) * absShaped) + 0.5)),
    farGain: f(1 - f(MAX_FAR_GAIN_CUT * absShaped)),
    damp: f(1 - f(DAMP_RANGE * absShaped)),
    rightIsNear: shaped >= 0,
  };
}
