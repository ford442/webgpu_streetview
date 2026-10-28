import { readCanvasFingerprint } from './canvasFingerprint';
import type { FrameSource } from './types';

/**
 * The scraped Google Maps canvas as a `FrameSource`, and the **one** place
 * that reads that canvas back.
 *
 * Three watchers need to know whether the Maps canvas shows stable imagery:
 * the scraper's canvas scan (`StreetView.tsx`), the hold-release gate
 * (`useStreetView.tsx`) and the renderers' upload guard. Each used to read
 * the canvas itself (one sync `getImageData` per Maps DOM mutation, plus
 * ~11/s from pollers). Now they ask this source, which
 *  - fingerprints asynchronously (`canvasFingerprint.ts`),
 *  - shares one sample between every caller that can accept its age,
 *  - runs at most one readback per canvas at a time, and
 *  - turns Maps' DOM churn into one structure event per frame, for canvas
 *    add/remove records only.
 */

/** How old a shared verdict the upload guard accepts before asking for a fresh one. */
export const UPLOAD_VERDICT_MAX_AGE_MS = 2000;

interface FingerprintEntry {
    fp: string;
    width: number;
    height: number;
    /** `performance.now()` when the sample was taken (not when it resolved). */
    at: number;
}

export interface FingerprintOptions {
    /** Reuse a sample at most this old (ms). 0 = always take a new one. */
    maxAgeMs?: number;
}

export interface FrameSourceStats {
    /** Readbacks actually issued. */
    samples: number;
    /** Requests answered from a shared sample (cached or in flight). */
    shared: number;
    /** Coalesced canvas add/remove events delivered to structure listeners. */
    structureEvents: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function touchesCanvas(nodes: NodeList): boolean {
    for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]!;
        if (node.nodeName === 'CANVAS') return true;
        if ((node as Element).getElementsByTagName?.('canvas').length) return true;
    }
    return false;
}

/** One frame later (or a macrotask where there is no rAF): Maps mutates in bursts. */
function nextFrame(callback: () => void): () => void {
    if (typeof requestAnimationFrame === 'function') {
        const id = requestAnimationFrame(() => callback());
        return () => cancelAnimationFrame(id);
    }
    const id = setTimeout(callback, 0);
    return () => clearTimeout(id);
}

export class MapsCanvasSource implements FrameSource {
    public readonly kind = 'maps-canvas' as const;
    private canvas: HTMLCanvasElement | null = null;
    private ver = 0;
    private readonly listeners = new Set<() => void>();
    private readonly structureListeners = new Set<() => void>();
    private cache = new WeakMap<HTMLCanvasElement, FingerprintEntry>();
    private inflight = new WeakMap<HTMLCanvasElement, Promise<string>>();
    private counters: FrameSourceStats = { samples: 0, shared: 0, structureEvents: 0 };
    private cancelStructureFrame: (() => void) | null = null;

    public element(): HTMLCanvasElement | null {
        return this.canvas;
    }

    public version(): number {
        return this.ver;
    }

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** The scraper promoted `canvas` (or re-promoted it with new content). */
    public setElement(canvas: HTMLCanvasElement | null): void {
        this.canvas = canvas;
        this.bump();
    }

    /**
     * Fingerprint `canvas` ('' = too small or near-black), sharing a sample
     * with other callers when one at most `maxAgeMs` old exists or is in flight.
     */
    public fingerprint(canvas: HTMLCanvasElement, options: FingerprintOptions = {}): Promise<string> {
        const hit = this.peek(canvas);
        if (hit && now() - hit.at <= (options.maxAgeMs ?? 0)) {
            this.counters.shared += 1;
            return Promise.resolve(hit.fp);
        }
        const pending = this.inflight.get(canvas);
        if (pending) {
            this.counters.shared += 1;
            return pending;
        }
        const at = now();
        const width = canvas.width;
        const height = canvas.height;
        this.counters.samples += 1;
        const sample = readCanvasFingerprint(canvas).then((fp) => {
            this.inflight.delete(canvas);
            const prev = this.cache.get(canvas);
            if (!prev || prev.at <= at) this.cache.set(canvas, { fp, width, height, at });
            return fp;
        });
        this.inflight.set(canvas, sample);
        return sample;
    }

    /** The last sample of `canvas` at its current backing size, if any. */
    public peek(canvas: HTMLCanvasElement): FingerprintEntry | undefined {
        const hit = this.cache.get(canvas);
        return hit && hit.width === canvas.width && hit.height === canvas.height ? hit : undefined;
    }

    /**
     * The per-frame upload guard: does `canvas` show imagery? Answers from the
     * shared verdict without reading back; an unknown or stale canvas starts
     * a background sample and, until it lands, reads as not ready (the
     * renderer keeps its last texture).
     */
    public isShowingImagery(canvas: HTMLCanvasElement): boolean {
        const hit = this.peek(canvas);
        if (!hit || now() - hit.at > UPLOAD_VERDICT_MAX_AGE_MS) {
            void this.fingerprint(canvas, { maxAgeMs: UPLOAD_VERDICT_MAX_AGE_MS });
        }
        return !!hit?.fp;
    }

    /**
     * Watch `container` for canvases being added or removed. Bursts coalesce
     * into one `onStructureChange` delivery per frame; every other Maps
     * mutation (tiles, controls, error chrome) is ignored.
     */
    public observe(container: HTMLElement): () => void {
        const observer = new MutationObserver((records) => {
            if (this.cancelStructureFrame) return;
            for (const record of records) {
                if (touchesCanvas(record.addedNodes) || touchesCanvas(record.removedNodes)) {
                    this.cancelStructureFrame = nextFrame(() => {
                        this.cancelStructureFrame = null;
                        this.counters.structureEvents += 1;
                        for (const listener of [...this.structureListeners]) listener();
                    });
                    return;
                }
            }
        });
        observer.observe(container, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            this.cancelStructureFrame?.();
            this.cancelStructureFrame = null;
        };
    }

    public onStructureChange(listener: () => void): () => void {
        this.structureListeners.add(listener);
        return () => {
            this.structureListeners.delete(listener);
        };
    }

    public stats(): FrameSourceStats {
        return { ...this.counters };
    }

    /** Tests and a scraper re-init: forget every sample and the promoted canvas. */
    public reset(): void {
        this.canvas = null;
        this.cache = new WeakMap();
        this.inflight = new WeakMap();
        this.counters = { samples: 0, shared: 0, structureEvents: 0 };
        this.cancelStructureFrame?.();
        this.cancelStructureFrame = null;
        this.bump();
    }

    private bump(): void {
        this.ver += 1;
        for (const listener of [...this.listeners]) listener();
    }
}

/** The app's one Maps canvas source (the scraper writes it; everything else reads). */
export const mapsCanvasSource = new MapsCanvasSource();
