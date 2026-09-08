import type { RearviewMirror } from '../RearviewMirror';
import type { RearViewSample } from '../rearViewFeed';
import { getState } from './state';

/**
 * The rearview and vanity glass.
 *
 * Kept apart from the rest of the cabin because the imagery behind it is
 * billable — `rearViewFeed.ts` and `BILLING_SAFETY_CHECKLIST.md` govern where
 * a sample may come from, and this module is the only way one reaches the glass.
 */

/**
 * Set the Street View canvas source for the rearview mirror.
 * Call this whenever the Street View canvas changes.
 */
export function setMirrorStreetViewCanvas(canvas: HTMLCanvasElement | null): void {
    const state = getState();
    if (!state) return;
    state.mirror.setStreetViewCanvas(canvas);
    state.interior.setVanityStreetViewCanvas(canvas);
}

/**
 * Bind a true rear-facing Street View Static sample to the rearview glass, or
 * pass null to return it to the honest unavailable state.
 *
 * Sourced by `useRearViewFeed` from `rearViewFeed.ts` — see that module before
 * calling this on any new path, the imagery is billable.
 */
export function setMirrorRearSample(sample: RearViewSample | null): void {
    const state = getState();
    if (!state) return;
    state.mirror.setRearSample(sample);
}

/** Diagnostic snapshot of the rearview glass (bound sample, pan, fade). */
export function getMirrorStatus(): ReturnType<RearviewMirror['getStatus']> | null {
    const state = getState();
    if (!state) return null;
    return state.mirror.getStatus();
}
