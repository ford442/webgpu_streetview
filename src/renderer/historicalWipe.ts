/**
 * Year-chip reveal for the historical time machine — the pure half.
 *
 * A year-chip hop is an ordinary hold-pause hop (`armHold()`); this decides how
 * the held "before" frame gives way to the new panorama once it is stable:
 * either a GPU wipe (`HistoricalWipePass`) or, under reduced motion, an
 * instant cut with no shader at all.
 *
 * The wipe has its own 4-float uniform — progress, direction, two pads — and
 * never touches the 44-float weather block (`weatherUniformLayout.ts`).
 */

/** Floats in the wipe uniform; must match `WipeUniforms` in `historical-wipe.wgsl`. */
export const WIPE_UNIFORM_FLOAT_COUNT = 4;

export const WipeUniformIndex = {
    progress: 0,
    direction: 1,
    pad0: 2,
    pad1: 3,
} as const;

/** Long enough to read as a sweep, short enough not to hold up the next hop. */
export const HISTORICAL_WIPE_DURATION_MS = 650;

/**
 * +1 sweeps the new capture in from the left (travelling forward in time,
 * matching the strip's left-to-right chronology); -1 sweeps in from the right.
 */
export type WipeDirection = 1 | -1;

export type HistoricalReveal =
    | { kind: 'wipe'; direction: WipeDirection }
    | { kind: 'cut' };

/**
 * Direction for a hop between two chips of the (chronologically ascending)
 * year strip. A hop to a later year is forward in time.
 */
export function wipeDirectionForHop(fromIndex: number, toIndex: number): WipeDirection {
    return toIndex >= fromIndex ? 1 : -1;
}

/** Reduced motion is a cut, never a shader. */
export function resolveHistoricalReveal(input: {
    reducedMotion: boolean;
    direction: WipeDirection;
}): HistoricalReveal {
    return input.reducedMotion ? { kind: 'cut' } : { kind: 'wipe', direction: input.direction };
}

/**
 * Eased wipe progress in [0, 1] for `elapsedMs` into a wipe of `durationMs`.
 * Smoothstep, so the edge eases in and settles rather than snapping. A
 * non-positive duration is already finished.
 */
export function wipeProgressAt(elapsedMs: number, durationMs: number = HISTORICAL_WIPE_DURATION_MS): number {
    if (!(durationMs > 0)) return 1;
    const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
    return t * t * (3 - 2 * t);
}

/** Pack the wipe uniform. Progress is clamped; any non-negative direction is +1. */
export function packWipeUniforms(progress: number, direction: WipeDirection): Float32Array {
    const data = new Float32Array(WIPE_UNIFORM_FLOAT_COUNT);
    data[WipeUniformIndex.progress] = Math.min(1, Math.max(0, progress));
    data[WipeUniformIndex.direction] = direction < 0 ? -1 : 1;
    return data;
}

/**
 * Whether the new ("after") panorama shows at horizontal position `u` (0 = left
 * edge). The TS twin of the `discard` test in `historical-wipe.wgsl`: the pass
 * draws the held frame only where this is false.
 */
export function isRevealedAt(u: number, progress: number, direction: WipeDirection): boolean {
    const along = direction < 0 ? 1 - u : u;
    return along < progress;
}

/**
 * The OS media query or the app's reduced-motion setting (which
 * `useAppAccessibility` mirrors onto `body.reduced-motion`).
 */
export function isReducedMotionRequested(
    env: { matchMedia?: (q: string) => { matches: boolean }; body?: { classList: { contains(c: string): boolean } } | null } =
        typeof window !== 'undefined' ? { matchMedia: window.matchMedia?.bind(window), body: document.body } : {},
): boolean {
    try {
        if (env.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    } catch {
        // matchMedia can throw in odd embeds — fall through to the app setting.
    }
    return !!env.body?.classList.contains('reduced-motion');
}
