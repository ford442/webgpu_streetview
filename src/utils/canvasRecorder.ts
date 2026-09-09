import { MAPS_ATTRIBUTION } from './attribution';

export type ClipRecorderState = 'idle' | 'recording' | 'stopped' | 'unsupported';

/**
 * A second canvas composited over the road frame — today, car mode's cabin.
 *
 * The cabin renderer has no `preserveDrawingBuffer`, so its canvas is only
 * readable inside the frame that drew it. `subscribe` therefore hands the
 * recorder the "just rendered" moment (`car/runtime/frameCapture.ts`) and
 * `getCanvas` is only ever called from inside that callback. When nothing
 * fires the callback — car mode off, or toggled off mid-clip — the latch stays
 * transparent and the clip is road-only, which is the correct fallback.
 */
export interface ClipOverlaySource {
  /** Only valid to read inside a `subscribe` callback. Null when unavailable. */
  getCanvas: () => HTMLCanvasElement | null;
  /** Register a post-render callback; returns an unsubscribe. */
  subscribe: (onRendered: () => void) => () => void;
}

export interface ClipRecorderOptions {
  /** Frames per second for captureStream. Default 30. */
  fps?: number;
  /** Burn attribution footer into the recorded frame. Default true. */
  burnAttribution?: boolean;
  /** Minimum clip length in ms (informational; enforced by caller). */
  minDurationMs?: number;
  /**
   * Composite this over the road frame. Supplying it forces the 2D composite
   * path even with `burnAttribution: false`, since a raw `captureStream` of the
   * road canvas has nowhere to put the overlay.
   */
  overlay?: ClipOverlaySource;
}

export interface ClipRecorderResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const PREFERRED_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

function createCompositeCanvas(
  source: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for clip composite');
  return { canvas, ctx };
}

/**
 * Blit source canvas to composite, drawing the overlay (cabin) over it and the
 * attribution footer over both. Call every frame while recording.
 *
 * `overlay` must be a canvas that is safe to read at any time — the recorder
 * passes its own latch, never a live GPU-backed canvas. See `ClipOverlaySource`.
 */
export function blitFrameWithAttribution(
  source: HTMLCanvasElement,
  composite: CanvasRenderingContext2D,
  burnAttribution: boolean,
  overlay?: HTMLCanvasElement | null,
): void {
  const w = source.width;
  const h = source.height;
  composite.drawImage(source, 0, 0, w, h);
  if (overlay && overlay.width > 0 && overlay.height > 0) {
    composite.drawImage(overlay, 0, 0, w, h);
  }
  if (!burnAttribution) return;

  const footerH = Math.max(18, Math.round(h * 0.028));
  composite.fillStyle = 'rgba(0,0,0,0.55)';
  composite.fillRect(0, h - footerH, w, footerH);
  composite.fillStyle = 'rgba(255,255,255,0.85)';
  composite.font = `${Math.max(10, Math.round(footerH * 0.55))}px system-ui, sans-serif`;
  composite.textBaseline = 'middle';
  composite.fillText(MAPS_ATTRIBUTION, 8, h - footerH / 2);
}

export function isClipRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && pickMimeType() !== undefined;
}

/**
 * Record a clip from a renderer canvas via captureStream + MediaRecorder.
 * When burnAttribution is true, samples are composited through a 2D canvas each frame.
 */
export class CanvasClipRecorder {
  private sourceCanvas: HTMLCanvasElement;
  private options: Required<Pick<ClipRecorderOptions, 'fps' | 'burnAttribution'>>;
  private mimeType: string;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private compositeCtx: CanvasRenderingContext2D | null = null;
  private rafId: number | null = null;
  private startedAt = 0;
  private state: ClipRecorderState = 'idle';
  private overlay: ClipOverlaySource | null;
  private overlayLatchCtx: CanvasRenderingContext2D | null = null;
  private unsubscribeOverlay: (() => void) | null = null;

  constructor(sourceCanvas: HTMLCanvasElement, options: ClipRecorderOptions = {}) {
    this.sourceCanvas = sourceCanvas;
    this.overlay = options.overlay ?? null;
    this.options = {
      fps: options.fps ?? 30,
      burnAttribution: options.burnAttribution ?? true,
    };
    const mime = pickMimeType();
    if (!mime) {
      this.mimeType = '';
      this.state = 'unsupported';
      return;
    }
    this.mimeType = mime;
  }

  getState(): ClipRecorderState {
    return this.state;
  }

  /**
   * Copy the overlay into a plain 2D canvas each time it renders. That latch is
   * readable at any time, so the composite tick below can run on its own rAF
   * without racing the car render loop.
   */
  private startOverlayLatch(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    const { ctx } = createCompositeCanvas(this.sourceCanvas);
    this.overlayLatchCtx = ctx;
    this.unsubscribeOverlay = overlay.subscribe(() => {
      const latch = this.overlayLatchCtx;
      if (!latch) return;
      const live = overlay.getCanvas();
      latch.clearRect(0, 0, latch.canvas.width, latch.canvas.height);
      if (live && live.width > 0 && live.height > 0) {
        latch.drawImage(live, 0, 0, latch.canvas.width, latch.canvas.height);
      }
    });
  }

  private stopOverlayLatch(): void {
    this.unsubscribeOverlay?.();
    this.unsubscribeOverlay = null;
    this.overlayLatchCtx = null;
  }

  start(): void {
    if (this.state === 'unsupported') {
      throw new Error('MediaRecorder / WebM not supported in this browser');
    }
    if (this.state === 'recording') return;

    this.chunks = [];
    let stream: MediaStream;

    // An overlay has nowhere to be drawn on a raw captureStream of the road
    // canvas, so it forces the 2D composite path regardless of attribution.
    if (this.options.burnAttribution || this.overlay) {
      const burn = this.options.burnAttribution;
      this.startOverlayLatch();
      const { canvas, ctx } = createCompositeCanvas(this.sourceCanvas);
      this.compositeCtx = ctx;
      blitFrameWithAttribution(this.sourceCanvas, ctx, burn, this.overlayLatchCtx?.canvas);
      stream = canvas.captureStream(this.options.fps);
      const tick = () => {
        if (this.state !== 'recording' || !this.compositeCtx) return;
        blitFrameWithAttribution(
          this.sourceCanvas,
          this.compositeCtx,
          burn,
          this.overlayLatchCtx?.canvas,
        );
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    } else {
      stream = this.sourceCanvas.captureStream(this.options.fps);
    }

    this.mediaRecorder = new MediaRecorder(stream, { mimeType: this.mimeType });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start(250);
    this.startedAt = performance.now();
    this.state = 'recording';
  }

  stop(): Promise<ClipRecorderResult> {
    if (this.state !== 'recording' || !this.mediaRecorder) {
      return Promise.reject(new Error('Not recording'));
    }

    const recorder = this.mediaRecorder;
    const durationMs = performance.now() - this.startedAt;

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
        this.stopOverlayLatch();
        this.state = 'stopped';
        const blob = new Blob(this.chunks, { type: this.mimeType });
        resolve({ blob, mimeType: this.mimeType, durationMs });
      };
      recorder.onerror = () => reject(new Error('MediaRecorder error'));
      recorder.stop();
    });
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stopOverlayLatch();
    this.mediaRecorder = null;
    this.compositeCtx = null;
    this.state = 'idle';
  }
}

/** Trigger a download of a recorded clip blob. */
export function downloadClip(blob: Blob, mimeType: string, baseName = 'streetview-clip'): void {
  const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName.replace(/[^a-z0-9-_ ]/gi, '_') || 'clip'}.${ext}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export type ClipShareResult = 'share' | 'download' | 'cancelled';

/**
 * Share a WebM via `navigator.share({ files })` when the UA allows it;
 * otherwise download. Optional deep link is included as `url` when sharing.
 */
export async function shareOrDownloadClip(
  blob: Blob,
  mimeType: string,
  options: { deepLink?: string; baseName?: string } = {},
): Promise<ClipShareResult> {
  const baseName = options.baseName ?? 'streetview-clip';
  const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
  const file = new File([blob], `${baseName}.${ext}`, { type: mimeType });

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const canShareFiles = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });
      if (canShareFiles) {
        await navigator.share({
          title: 'Street View clip',
          files: [file],
          ...(options.deepLink ? { url: options.deepLink } : {}),
        });
        return 'share';
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  downloadClip(blob, mimeType, baseName);
  return 'download';
}
