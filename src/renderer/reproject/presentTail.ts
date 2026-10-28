/**
 * What the split frame's tail does (#331) and what it last did.
 *
 * Options come from `?latelatch` / `?stereo` (`config/flags.ts`) plus reduced
 * motion, resolved once per frame by `WebGPUCanvas`; the stats are the probe's
 * view of it (`window.__STREETVIEW_PROBE__.getLateLatch()`).
 */
import { readFlag } from '../../config/flags';
import type { LatchDelta, ReprojectMode } from './reprojectMath';
import type { FrameTailStats } from './frameTail';

type StereoMode = 'off' | 'sbs' | 'anaglyph';

export interface PresentTailOptions {
    /** Re-aim the road at the POV read at tail time. */
    latch: boolean;
    stereo: StereoMode;
    /** Blur the stereo disocclusion fill — off under reduced motion. */
    fillBlur: boolean;
}

export const PRESENT_TAIL_OFF: PresentTailOptions = { latch: false, stereo: 'off', fillBlur: true };

export function wantsTail(options: PresentTailOptions): boolean {
    return options.latch || options.stereo !== 'off';
}

export interface PresentTailInput {
    reducedMotion: boolean;
    /** `?latelatch`; unset = off. */
    latch?: boolean;
    /** `?stereo`; unset = off. */
    stereo?: StereoMode | undefined;
}

/** Fill a reusable options object — `WebGPUCanvas` calls this every frame. */
export function resolvePresentTailOptions(
    input: PresentTailInput,
    out: PresentTailOptions = { ...PRESENT_TAIL_OFF },
): PresentTailOptions {
    out.latch = input.latch ?? false;
    out.stereo = input.stereo ?? 'off';
    out.fillBlur = !input.reducedMotion;
    return out;
}

/** The URL's choice, read once per mount. */
export function readPresentTailFlags(): Pick<PresentTailInput, 'latch' | 'stereo'> {
    return { latch: readFlag('latelatch') ?? false, stereo: readFlag('stereo') };
}

export interface LateLatchStats {
    enabled: boolean;
    mode: ReprojectMode | 'none';
    /** The last tail's correction, degrees. 0 at rest. */
    latchDeltaDeg: number;
    /** Largest correction since the probe was cleared. */
    maxLatchDeltaDeg: number;
    frames: FrameTailStats;
}

let stats: LateLatchStats = {
    enabled: false,
    mode: 'none',
    latchDeltaDeg: 0,
    maxLatchDeltaDeg: 0,
    frames: { ran: 0, deferred: 0, dropped: 0 },
};

export function recordTail(
    options: PresentTailOptions,
    mode: ReprojectMode,
    delta: LatchDelta,
    frames: FrameTailStats,
): void {
    stats.enabled = wantsTail(options);
    stats.mode = mode;
    stats.latchDeltaDeg = delta.magnitudeDeg;
    stats.maxLatchDeltaDeg = Math.max(stats.maxLatchDeltaDeg, delta.magnitudeDeg);
    stats.frames = frames;
}

/** A frame without a tail: nothing latched. */
export function recordNoTail(): void {
    if (!stats.enabled && stats.mode === 'none') return;
    stats.enabled = false;
    stats.mode = 'none';
    stats.latchDeltaDeg = 0;
}

export function getLateLatchStats(): LateLatchStats {
    return { ...stats, frames: { ...stats.frames } };
}

export function clearLateLatchStats(): void {
    stats = { ...stats, latchDeltaDeg: 0, maxLatchDeltaDeg: 0 };
}
