/** Rolling GPU pass timings (ms) surfaced in PerformanceStatsOverlay when timestamp-query is available. */

export interface GpuPassTimings {
    pass1Ms: number | null;
    weatherMs: number | null;
    blitMs: number | null;
    available: boolean;
    lastUpdated: number;
}

const INITIAL: GpuPassTimings = {
    pass1Ms: null,
    weatherMs: null,
    blitMs: null,
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
