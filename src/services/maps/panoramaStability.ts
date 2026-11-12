/**
 * Single source of truth for "is this panorama canvas stable and showing
 * real imagery yet?" Used by three watchers that must agree on timing or the
 * hold-pause feature regresses (blurry/torn frames flash through, or the hold
 * lingers longer than necessary):
 *  - StreetView.tsx's checkForCanvas scan (initial DOM canvas promotion)
 *  - useStreetView.tsx's pano_changed stability loop (hold-release gating)
 *  - the renderers' live-upload guard (per-frame upload gate)
 * All three read the canvas through `renderer/frameSource/mapsCanvasSource`,
 * which owns the readback and shares one sample between them.
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

/**
 * The `WxH` part of a `getCanvasFingerprint` result, or '' for an empty one.
 * Lets callers tell a backing-size change apart from a content change.
 */
export function fingerprintSize(fp: string): string {
  const dash = fp.indexOf('-');
  return dash > 0 ? fp.slice(0, dash) : '';
}

/** Side of the centre square a fingerprint samples, in source pixels. */
export const FINGERPRINT_REGION_PX = 128;
/** The region is box-downsampled to this many pixels per side before hashing. */
export const FINGERPRINT_GRID = 4;

/** The centre region `getCanvasFingerprint` samples (source pixels). */
export function fingerprintRegion(width: number, height: number): { sx: number; sy: number } {
  return {
    sx: Math.floor(width / 2 - FINGERPRINT_REGION_PX / 2),
    sy: Math.floor(height / 2 - FINGERPRINT_REGION_PX / 2),
  };
}

/**
 * Hash `FINGERPRINT_GRID`² RGBA pixels into a `WxH-hash` fingerprint, or ''
 * when the canvas is too small or near-black (still loading). Shared by the
 * synchronous reader below and the async one in `renderer/frameSource`.
 */
export function fingerprintFromPixels(d: ArrayLike<number>, width: number, height: number): string {
  let hash = 0;
  let brightness = 0;
  for (let i = 0; i + 2 < d.length; i += 4) {
    hash = ((hash << 5) - hash) + d[i]! + d[i + 1]! + d[i + 2]!;
    brightness += d[i]! + d[i + 1]! + d[i + 2]!;
  }
  // Mostly black = probably still loading, but allow very dark valid frames
  // (e.g. nighttime/error screens) to pass so we don't hang forever.
  const avgBrightness = brightness / ((d.length / 4) * 3);
  if (avgBrightness < 2) return '';
  return `${width}x${height}-${hash}`;
}

/** True when a canvas is large enough to fingerprint at all. */
export function isFingerprintable(width: number, height: number): boolean {
  return width >= 256 && height >= 256;
}

let sharedOffscreenCanvas: HTMLCanvasElement | null = null;
let sharedOffscreenCtx: CanvasRenderingContext2D | null = null;

/** The memoized `FINGERPRINT_GRID`² 2D context both readers draw into. */
export function fingerprintScratchContext(): CanvasRenderingContext2D | null {
  if (!sharedOffscreenCanvas) {
    sharedOffscreenCanvas = document.createElement('canvas');
    sharedOffscreenCanvas.width = FINGERPRINT_GRID;
    sharedOffscreenCanvas.height = FINGERPRINT_GRID;
  }
  if (!sharedOffscreenCtx) {
    sharedOffscreenCtx = sharedOffscreenCanvas.getContext('2d', { willReadFrequently: true });
  }
  return sharedOffscreenCtx;
}

/**
 * Synchronous pixel fingerprint: a `drawImage` + `getImageData` of the source
 * canvas — a GPU→CPU sync point on a WebGL canvas. App code does not call
 * this directly: `renderer/frameSource/mapsCanvasSource.ts` owns every read
 * of the Maps canvas and uses the async reader where the browser has one.
 */
export function getCanvasFingerprint(canvas: HTMLCanvasElement): string {
  const w = canvas.width;
  const h = canvas.height;
  if (!isFingerprintable(w, h)) return '';
  try {
    const ctx = fingerprintScratchContext();
    if (!ctx) return '';
    const { sx, sy } = fingerprintRegion(w, h);
    ctx.drawImage(
      canvas, sx, sy, FINGERPRINT_REGION_PX, FINGERPRINT_REGION_PX,
      0, 0, FINGERPRINT_GRID, FINGERPRINT_GRID,
    );
    return fingerprintFromPixels(ctx.getImageData(0, 0, FINGERPRINT_GRID, FINGERPRINT_GRID).data, w, h);
  } catch {
    return '';
  }
}
