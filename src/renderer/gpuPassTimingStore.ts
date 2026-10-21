/** Rolling GPU pass timings (ms) surfaced in PerformanceStatsOverlay when timestamp-query is available. */

export interface GpuPassTimings {
    pass1Ms: number | null;
    weatherMs: number | null;
    blitMs: number | null;
    /** The render-scale upscale (EASU + RCAS, or bilinear); null at scale 1. */
    upscaleMs: number | null;
    /** The render scale of the frame these spans timed (`renderScale.ts`). */
    renderScale: number | null;
    /** Increments per read-back — a consumer's "is this sample new". */
    seq: number;
    available: boolean;
    lastUpdated: number;
}

const INITIAL: GpuPassTimings = {
    pass1Ms: null,
    weatherMs: null,
    blitMs: null,
    upscaleMs: null,
    renderScale: null,
    seq: 0,
    available: false,
    lastUpdated: 0,
};

let current: GpuPassTimings = { ...INITIAL };

export function getGpuPassTimings(): GpuPassTimings {
    return current;
}

export function setGpuPassTimings(next: Partial<GpuPassTimings>): void {
    current = { ...current, ...next, lastUpdated: Date.now() };
}

export function resetGpuPassTimings(): void {
    current = { ...INITIAL };
}

export function publishGpuPassTimingsToWindow(): void {
    if (typeof window === 'undefined') return;
    (window as Window & { rendererGpuTimings?: GpuPassTimings }).rendererGpuTimings = current;
}

/**
 * The road's GPU time for one frame — what the frame-budget loop
 * (`frameBudget.ts`) weighs — or null when pass 1 or weather was not timed.
 */
export function roadGpuMs(t: GpuPassTimings): number | null {
    if (t.pass1Ms == null || t.weatherMs == null) return null;
    return t.pass1Ms + t.weatherMs + (t.blitMs ?? 0) + (t.upscaleMs ?? 0);
}

/**
 * Who is reading pass timings. Timestamp queries cost a resolve, a buffer copy
 * and a `mapAsync` per frame, so the frame loop only stamps passes while the
 * performance overlay (P) is open or the frame-budget loop is running.
 */
export type GpuPassTimingsConsumer = 'overlay' | 'budget';

const timingsWanted = new Set<GpuPassTimingsConsumer>();

export function setGpuPassTimingsWanted(wanted: boolean, consumer: GpuPassTimingsConsumer = 'overlay'): void {
    if (wanted) timingsWanted.add(consumer);
    else timingsWanted.delete(consumer);
}

export function areGpuPassTimingsWanted(): boolean {
    return timingsWanted.size > 0;
}
