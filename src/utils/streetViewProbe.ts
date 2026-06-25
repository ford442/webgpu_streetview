/**
 * Dev-facing guard + timing instrumentation for the panorama hold-pause
 * feature (advance()/teleport() -> beginHoldTransition() -> ... ->
 * endHoldTransition()).
 *
 * The invariant this exists to protect: while a hold is active, the
 * user-visible WebGPU output must be derived only from the pre-transition
 * captured frame (+ live weather/overlays), never from new Google Maps
 * canvas content. Two prior attempts at this feature regressed on exactly
 * this point ("the blur leaks back") without anything noticing — this
 * module gives future changes a loud, immediate signal instead of relying
 * on someone spotting it in a screenshot.
 *
 * Wired into Renderer.uploadLiveSource() (the actual leak vector) and
 * WebGPUCanvas.tsx's render loop (the call-site gate), and exposed at
 * window.__STREETVIEW_PROBE__ for DevTools / headless scripts
 * (see scripts/hold-pause-probe.mjs).
 */

export interface HoldTimelineEntry {
  armedAt: number;
  firstStableAt: number | null;
  releasedAt: number | null;
  /** releasedAt - armedAt, once released. */
  holdDurationMs: number | null;
}

export interface ProbeWarning {
  at: number;
  message: string;
}

const MAX_TIMELINE_ENTRIES = 25;
const MAX_WARNINGS = 50;
/** Tick-to-tick brightness jump (out of ~765 max) large enough to suggest a
 * different frame swapped in, rather than gradual weather/look-around drift. */
const PIXEL_DRIFT_THRESHOLD = 90;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

let sampleCanvas: HTMLCanvasElement | null = null;
let sampleCtx: CanvasRenderingContext2D | null = null;

/** Coarse average brightness of a small region, cheap enough to call every frame. */
function sampleBrightness(canvas: HTMLCanvasElement): number | null {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 64 || h < 64) return null;
  try {
    if (!sampleCanvas) {
      sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 4;
      sampleCanvas.height = 4;
    }
    if (!sampleCtx) {
      sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!sampleCtx) return null;
    const sx = Math.floor(w / 2 - 32);
    const sy = Math.floor(h / 2 - 32);
    sampleCtx.drawImage(canvas, sx, sy, 64, 64, 0, 0, 4, 4);
    const d = sampleCtx.getImageData(0, 0, 4, 4).data;
    let brightness = 0;
    for (let i = 0; i < d.length; i += 4) {
      brightness += d[i] + d[i + 1] + d[i + 2];
    }
    return brightness / (d.length / 4);
  } catch {
    return null;
  }
}

class StreetViewProbe {
  private timeline: HoldTimelineEntry[] = [];
  private warnings: ProbeWarning[] = [];
  private current: HoldTimelineEntry | null = null;
  private pixelWatchEnabled = false;
  private lastBrightness: number | null = null;

  holdArmed(): void {
    this.current = { armedAt: now(), firstStableAt: null, releasedAt: null, holdDurationMs: null };
    this.timeline.push(this.current);
    if (this.timeline.length > MAX_TIMELINE_ENTRIES) this.timeline.shift();
    this.lastBrightness = null;
    console.log(`[StreetViewProbe] hold armed at T=${this.current.armedAt.toFixed(0)}ms`);
  }

  firstStable(): void {
    if (this.current && this.current.firstStableAt === null) {
      this.current.firstStableAt = now();
      console.log(
        `[StreetViewProbe] first stable at T+${(this.current.firstStableAt - this.current.armedAt).toFixed(0)}ms`
      );
    }
  }

  released(): void {
    if (this.current) {
      this.current.releasedAt = now();
      this.current.holdDurationMs = this.current.releasedAt - this.current.armedAt;
      console.log(`[StreetViewProbe] released at T+${this.current.holdDurationMs.toFixed(0)}ms (hold total)`);
      this.current = null;
    }
  }

  warnLeak(message: string): void {
    this.warnings.push({ at: now(), message });
    if (this.warnings.length > MAX_WARNINGS) this.warnings.shift();
    console.warn(`[StreetViewProbe] INVARIANT VIOLATION: ${message}`);
  }

  /** Opt-in: tick-to-tick brightness sampling of the visible canvas while a hold is
   * active. Off by default (extra drawImage/getImageData per frame); enable from
   * DevTools or the headless probe script when chasing a suspected leak. */
  enablePixelWatch(): void {
    this.pixelWatchEnabled = true;
    this.lastBrightness = null;
  }

  disablePixelWatch(): void {
    this.pixelWatchEnabled = false;
    this.lastBrightness = null;
  }

  /** Call once per rendered frame while holdActive is true. No-op unless pixel
   * watch is enabled. Heuristic only: flags abrupt jumps, not gradual drift from
   * weather animation or intentional look-around panning. */
  checkPixelDrift(canvas: HTMLCanvasElement): void {
    if (!this.pixelWatchEnabled) return;
    const brightness = sampleBrightness(canvas);
    if (brightness === null) return;
    if (this.lastBrightness !== null) {
      const delta = Math.abs(brightness - this.lastBrightness);
      if (delta > PIXEL_DRIFT_THRESHOLD) {
        this.warnLeak(
          `abrupt brightness jump (${this.lastBrightness.toFixed(1)} -> ${brightness.toFixed(1)}) while hold active — possible live GMaps content leak`
        );
      }
    }
    this.lastBrightness = brightness;
  }

  getTimeline(): HoldTimelineEntry[] {
    return this.timeline.slice();
  }

  getWarnings(): ProbeWarning[] {
    return this.warnings.slice();
  }

  clear(): void {
    this.timeline = [];
    this.warnings = [];
    this.current = null;
    this.lastBrightness = null;
  }
}

export const streetViewProbe = new StreetViewProbe();

declare global {
  interface Window {
    __STREETVIEW_PROBE__?: {
      getTimeline: () => HoldTimelineEntry[];
      getWarnings: () => ProbeWarning[];
      enablePixelWatch: () => void;
      disablePixelWatch: () => void;
      clear: () => void;
    };
  }
}

export function installStreetViewProbe(): void {
  if (typeof window === 'undefined') return;
  window.__STREETVIEW_PROBE__ = {
    getTimeline: () => streetViewProbe.getTimeline(),
    getWarnings: () => streetViewProbe.getWarnings(),
    enablePixelWatch: () => streetViewProbe.enablePixelWatch(),
    disablePixelWatch: () => streetViewProbe.disablePixelWatch(),
    clear: () => streetViewProbe.clear(),
  };
}
