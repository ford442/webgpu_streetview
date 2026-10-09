/**
 * Auto exposure: eases the GpuChores luma hint into the weather `exposure`
 * uniform (`WeatherParamIndex.exposure`). Opt-in and session-only — off by
 * default so shipped grades do not move.
 *
 * The EV maths is `exposureHintFromMeanLuma` (lumaMath.ts); this module only
 * smooths it. One smoother for every chores backend (WebGPU, WASM, JS) —
 * they all publish `meanLuma` through `gpuChoresStatsStore`.
 *
 * Pure functions only (the status store at the bottom is a plain module
 * variable for the perf overlay). Covered by autoExposure.test.ts.
 */
import { exposureHintFromMeanLuma } from './gpuChores/lumaMath';

/** Ease time constant. Roughly 95% of a step lands in 3·τ ≈ 1 s. */
export const AUTO_EXPOSURE_TAU_MS = 350;

/** Same ±2 EV clamp as `exposureHintFromMeanLuma`. */
export const AUTO_EXPOSURE_MAX_EV = 2;

/** Longest frame gap we integrate in one step (tab switch, debugger pause). */
const MAX_STEP_MS = 250;

function clampEv(ev: number): number {
  if (ev > AUTO_EXPOSURE_MAX_EV) return AUTO_EXPOSURE_MAX_EV;
  if (ev < -AUTO_EXPOSURE_MAX_EV) return -AUTO_EXPOSURE_MAX_EV;
  return ev;
}

/**
 * One exponential-ease step from `current` toward `target`. Never overshoots
 * the target and never leaves the ±2 EV clamp. Reduced motion snaps.
 */
export function smoothExposureStep(
  current: number,
  target: number,
  dtMs: number,
  reducedMotion: boolean,
  tauMs: number = AUTO_EXPOSURE_TAU_MS,
): number {
  const t = clampEv(target);
  if (reducedMotion || !(tauMs > 0)) return t;
  const dt = Math.min(Math.max(dtMs, 0), MAX_STEP_MS);
  const alpha = 1 - Math.exp(-dt / tauMs);
  return clampEv(current + (t - current) * alpha);
}

/** Events that change whether auto exposure is allowed to drive the uniform. */
export type AutoExposureEvent =
  | 'toggle-on'
  | 'toggle-off'
  | 'manual-exposure'
  | 'color-grading-preset'
  | 'time-of-day-preset'
  | 'look-pack';

/**
 * Toggle reducer. Any user exposure write (slider, colour-grading preset,
 * time-of-day preset, named look) wins immediately and turns auto exposure
 * off; only the toggle turns it back on.
 */
export function nextAutoExposureEnabled(_current: boolean, event: AutoExposureEvent): boolean {
  return event === 'toggle-on';
}

export interface AutoExposureFrameInput {
  enabled: boolean;
  /** Hold-pause (cruise hop / loading canvas). Freezes the smoothed value. */
  holdActive: boolean;
  /** Latest GpuChores mean luma, or null when no backend has sampled yet. */
  meanLuma: number | null;
  /** The slider / preset exposure (`env.exposure`). Seed for the first ease. */
  manualExposure: number;
  dtMs: number;
  reducedMotion: boolean;
}

export interface AutoExposureFrameState {
  /** Last smoothed EV written to the uniform; null when not engaged. */
  smoothedEv: number | null;
}

export interface AutoExposureFrameResult {
  state: AutoExposureFrameState;
  /** EV to write into the exposure uniform, or null to leave it alone. */
  exposure: number | null;
  /** Current hint (display), null when no luma sample exists. */
  hintEv: number | null;
}

export const AUTO_EXPOSURE_IDLE: AutoExposureFrameState = { smoothedEv: null };

/**
 * Per-frame resolver. Toggle off → never writes, and resets so the next
 * enable eases from the manual exposure instead of a stale value. Hold →
 * returns the last smoothed value untouched.
 */
export function resolveAutoExposureFrame(
  input: AutoExposureFrameInput,
  state: AutoExposureFrameState,
): AutoExposureFrameResult {
  const hintEv = input.meanLuma != null ? exposureHintFromMeanLuma(input.meanLuma) : null;
  if (!input.enabled) {
    return { state: AUTO_EXPOSURE_IDLE, exposure: null, hintEv };
  }
  const current = state.smoothedEv ?? clampEv(input.manualExposure);
  if (input.holdActive || hintEv == null) {
    return { state: { smoothedEv: current }, exposure: current, hintEv };
  }
  const next = smoothExposureStep(current, hintEv, input.dtMs, input.reducedMotion);
  return { state: { smoothedEv: next }, exposure: next, hintEv };
}

/** Snapshot for the performance overlay. */
export interface AutoExposureStatus {
  enabled: boolean;
  /** EV currently written to the uniform by auto exposure, else null. */
  appliedEv: number | null;
  holdActive: boolean;
}

let status: AutoExposureStatus = { enabled: false, appliedEv: null, holdActive: false };

export function getAutoExposureStatus(): AutoExposureStatus {
  return status;
}

export function setAutoExposureStatus(next: AutoExposureStatus): void {
  status = next;
}
