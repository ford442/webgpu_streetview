/**
 * The temporal resolve's per-frame report (#360), on `window.webgpuProbe.temporal`
 * — what e2e and DevTools read to tell "history reset this frame, and why"
 * from "the resolve is not presenting". One object, mutated per frame (no
 * per-frame allocation), like `renderScale.ts`'s applied record.
 */
import type { TemporalMode } from './temporalMath';

export interface TemporalStats {
    /** `?temporal`, as the renderer read it at boot. */
    mode: TemporalMode;
    /** The resolve presented the last road frame (`renderScale.upscale === 'temporal'`). */
    presenting: boolean;
    /** It blended history on that frame. */
    history: boolean;
    /** Why it did not (`TemporalHistoryTracker`), or `weather-only` / `off`; null when it did. */
    historyReset: string | null;
    /** Why the motion field was zero, or null. */
    motionReset: string | null;
    /** The jitter pass 1 sampled with, intermediate pixels. */
    jitter: [number, number];
    /** Jitter phases in the sequence at this scale. */
    phases: number;
    /** Resolved frames since boot, and how many of them started from no history. */
    frames: number;
    resets: number;
}

const stats: TemporalStats = {
    mode: 'off',
    presenting: false,
    history: false,
    historyReset: null,
    motionReset: null,
    jitter: [0, 0],
    phases: 0,
    frames: 0,
    resets: 0,
};

export function getTemporalStats(): Readonly<TemporalStats> {
    return stats;
}

export interface TemporalStatsFrame {
    mode: TemporalMode;
    presenting: boolean;
    history: boolean;
    historyReset: string | null;
    motionReset: string | null;
    jitter: readonly [number, number];
    phases: number;
}

/** The renderer's per-frame report. */
export function publishTemporalStats(frame: TemporalStatsFrame): void {
    stats.mode = frame.mode;
    stats.presenting = frame.presenting;
    stats.history = frame.history;
    stats.historyReset = frame.historyReset;
    stats.motionReset = frame.motionReset;
    stats.jitter[0] = frame.jitter[0];
    stats.jitter[1] = frame.jitter[1];
    stats.phases = frame.phases;
    if (frame.presenting) {
        stats.frames += 1;
        if (!frame.history) stats.resets += 1;
    }
    if (typeof window === 'undefined') return;
    const probe = window.webgpuProbe;
    if (probe && probe.temporal !== stats) probe.temporal = stats;
}

export function resetTemporalStatsForTests(): void {
    Object.assign(stats, {
        mode: 'off',
        presenting: false,
        history: false,
        historyReset: null,
        motionReset: null,
        jitter: [0, 0],
        phases: 0,
        frames: 0,
        resets: 0,
    } satisfies TemporalStats);
}
