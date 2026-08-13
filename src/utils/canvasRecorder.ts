import { MAPS_ATTRIBUTION } from './attribution';

export type ClipRecorderState = 'idle' | 'recording' | 'stopped' | 'unsupported';

export interface ClipRecorderOptions {
  /** Frames per second for captureStream. Default 30. */
  fps?: number;
  /** Burn attribution footer into the recorded frame. Default true. */
  burnAttribution?: boolean;
  /** Minimum clip length in ms (informational; enforced by caller). */
  minDurationMs?: number;
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
 * Blit source canvas to composite, optionally drawing attribution footer.
 * Call every frame while recording when burnAttribution is enabled.
 */
export function blitFrameWithAttribution(
  source: HTMLCanvasElement,
  composite: CanvasRenderingContext2D,
  burnAttribution: boolean,
): void {
  const w = source.width;
  const h = source.height;
  composite.drawImage(source, 0, 0, w, h);
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

  constructor(sourceCanvas: HTMLCanvasElement, options: ClipRecorderOptions = {}) {
    this.sourceCanvas = sourceCanvas;
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

  start(): void {
    if (this.state === 'unsupported') {
      throw new Error('MediaRecorder / WebM not supported in this browser');
    }
    if (this.state === 'recording') return;

    this.chunks = [];
    let stream: MediaStream;

    if (this.options.burnAttribution) {
      const { canvas, ctx } = createCompositeCanvas(this.sourceCanvas);
      this.compositeCtx = ctx;
      blitFrameWithAttribution(this.sourceCanvas, ctx, true);
      stream = canvas.captureStream(this.options.fps);
      const tick = () => {
        if (this.state !== 'recording' || !this.compositeCtx) return;
        blitFrameWithAttribution(this.sourceCanvas, this.compositeCtx, true);
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
