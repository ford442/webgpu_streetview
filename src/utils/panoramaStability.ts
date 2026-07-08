/**
 * Single source of truth for "is this panorama canvas stable and showing
 * real imagery yet?" Used by three independent watchers that must agree on
 * timing or the hold-pause feature regresses (blurry/torn frames flash
 * through, or the hold lingers longer than necessary):
 *  - StreetView.tsx's checkForCanvas poller (initial DOM canvas promotion)
 *  - useStreetView.tsx's pano_changed stability loop (hold-release gating)
 *  - Renderer.ts's uploadLiveSource guard (per-frame upload gate)
 *
 * Changing any constant here changes all three paths identically.
 */

export const STABILITY_POLL_INTERVAL_MS = 100;
export const STABILITY_REQUIRED_STABLE_MS = 500;
export const STABILITY_MIN_DELAY_MS = 400;
export const STABILITY_MAX_WAIT_MS = 1500;

export const STABILITY_REQUIRED_STABLE_TICKS = Math.round(
  STABILITY_REQUIRED_STABLE_MS / STABILITY_POLL_INTERVAL_MS
);
export const STABILITY_MIN_DELAY_TICKS = Math.round(
  STABILITY_MIN_DELAY_MS / STABILITY_POLL_INTERVAL_MS
);
export const STABILITY_MAX_TICKS = Math.round(
  STABILITY_MAX_WAIT_MS / STABILITY_POLL_INTERVAL_MS
);

/** True once the canvas fingerprint diverges from the pre-hold baseline. */
export function hasPanoramaContentChanged(
  fingerprint: string,
  holdBaselineFingerprint: string
): boolean {
  if (!holdBaselineFingerprint) return true;
  if (!fingerprint) return false;
  return fingerprint !== holdBaselineFingerprint;
}

export interface PanoramaStabilityTickState {
  tickCount: number;
  stableCount: number;
  lastFingerprint: string;
  sawContentChange: boolean;
}

export function createPanoramaStabilityState(
  holdBaselineFingerprint: string
): PanoramaStabilityTickState {
  return {
    tickCount: 0,
    stableCount: 0,
    lastFingerprint: '',
    // No baseline (e.g. first paint) — any stable content is acceptable.
    sawContentChange: !holdBaselineFingerprint,
  };
}

export type PanoramaStabilityTickOutcome =
  | { type: 'continue' }
  | { type: 'ready' }
  | { type: 'force-ready'; reason: 'status-error' | 'no-canvas-timeout' | 'timeout' };

/**
 * One poll tick of the pano_changed stability gate. Shared by useStreetView and
 * unit tests so hold-release timing cannot drift from the documented contract.
 */
export function advancePanoramaStabilityTick(
  state: PanoramaStabilityTickState,
  opts: {
    fingerprint: string;
    holdBaselineFingerprint: string;
    panoStatus?: string;
    hasCanvas: boolean;
  }
): { outcome: PanoramaStabilityTickOutcome; state: PanoramaStabilityTickState } {
  const next: PanoramaStabilityTickState = {
    ...state,
    tickCount: state.tickCount + 1,
  };

  const status = opts.panoStatus;
  if (status && status !== 'OK') {
    return { outcome: { type: 'force-ready', reason: 'status-error' }, state: next };
  }

  if (!opts.hasCanvas) {
    if (next.tickCount >= STABILITY_MAX_TICKS) {
      return { outcome: { type: 'force-ready', reason: 'no-canvas-timeout' }, state: next };
    }
    return { outcome: { type: 'continue' }, state: { ...next, stableCount: 0 } };
  }

  const { fingerprint } = opts;
  if (hasPanoramaContentChanged(fingerprint, opts.holdBaselineFingerprint)) {
    next.sawContentChange = true;
  }

  if (fingerprint && next.sawContentChange && fingerprint === next.lastFingerprint) {
    next.stableCount++;
    if (
      next.stableCount >= STABILITY_REQUIRED_STABLE_TICKS &&
      next.tickCount >= STABILITY_MIN_DELAY_TICKS
    ) {
      return { outcome: { type: 'ready' }, state: next };
    }
  } else if (fingerprint !== next.lastFingerprint) {
    next.stableCount = 0;
    next.lastFingerprint = fingerprint;
  }

  if (next.tickCount >= STABILITY_MAX_TICKS) {
    return { outcome: { type: 'force-ready', reason: 'timeout' }, state: next };
  }

  return { outcome: { type: 'continue' }, state: next };
}

let sharedOffscreenCanvas: HTMLCanvasElement | null = null;
let sharedOffscreenCtx: CanvasRenderingContext2D | null = null;

/**
 * Lightweight pixel fingerprint to detect canvas stability. Samples a small
 * center region so it's cheap enough to poll every tick.
 */
export function getCanvasFingerprint(canvas: HTMLCanvasElement): string {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 256 || h < 256) return '';
  try {
    if (!sharedOffscreenCanvas) {
      sharedOffscreenCanvas = document.createElement('canvas');
      sharedOffscreenCanvas.width = 4;
      sharedOffscreenCanvas.height = 4;
    }
    if (!sharedOffscreenCtx) {
      sharedOffscreenCtx = sharedOffscreenCanvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = sharedOffscreenCtx;
    if (!ctx) return '';

    const sx = Math.floor(w / 2 - 64);
    const sy = Math.floor(h / 2 - 64);
    ctx.drawImage(canvas, sx, sy, 128, 128, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    let hash = 0;
    let brightness = 0;
    for (let i = 0; i < d.length; i += 4) {
      hash = ((hash << 5) - hash) + d[i] + d[i + 1] + d[i + 2];
      brightness += d[i] + d[i + 1] + d[i + 2];
    }
    // Mostly black = probably still loading, but allow very dark valid frames
    // (e.g. nighttime/error screens) to pass so we don't hang forever.
    const avgBrightness = brightness / ((d.length / 4) * 3);
    if (avgBrightness < 2) return '';
    return `${w}x${h}-${hash}`;
  } catch {
    return '';
  }
}
