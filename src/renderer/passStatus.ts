/**
 * Per-pass health, published on `window.webgpuProbe.passes`.
 *
 * Every frame pass ends boot `ready` or `failed(reason)`. A failed pass is
 * skipped by the frame loop and reported here — it never takes down the road
 * frame (unless it *is* the road frame: `streetview` failing is a boot
 * failure). Playwright and DevTools read this to tell "the cabin pass did not
 * compile" apart from "the cabin is not in this frame".
 */
import type { ShaderDiagnostic } from './gpuPipelineFactory';
import { GpuValidationError } from './gpuPipelineFactory';

export type FramePassId =
    | 'streetview'
    | 'transitions'
    | 'historical-wipe'
    | 'weather'
    | 'present-fallback'
    | 'cabin-composite';

export type PassState = 'ready' | 'failed';

export interface PassStatus {
    state: PassState;
    /** Why it failed — the validation message, or the fetch error. */
    reason?: string;
    /** WGSL diagnostics, when the failure was a compilation error. */
    compilation?: ShaderDiagnostic[];
}

export type PassStatusRecord = Partial<Record<FramePassId, PassStatus>>;

let statuses: PassStatusRecord = {};

type ProbeWindow = Window & { webgpuProbe?: { passes?: PassStatusRecord } };

function publish(): void {
    if (typeof window === 'undefined') return;
    const probe = (window as ProbeWindow).webgpuProbe;
    if (probe) probe.passes = statuses;
}

/** Fresh record for a new boot — a re-init must not inherit the last device's failures. */
export function resetPassStatuses(): void {
    statuses = {};
    publish();
}

export function reportPassReady(id: FramePassId): void {
    statuses[id] = { state: 'ready' };
    publish();
}

export function reportPassFailed(id: FramePassId, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    const status: PassStatus = { state: 'failed', reason };
    if (error instanceof GpuValidationError && error.diagnostics.length > 0) {
        status.compilation = error.diagnostics;
    }
    statuses[id] = status;
    console.warn(`[Renderer] ${id} pass failed — disabled:`, reason);
    publish();
}

export function getPassStatus(id: FramePassId): PassStatus | undefined {
    return statuses[id];
}

export function isPassFailed(id: FramePassId): boolean {
    return statuses[id]?.state === 'failed';
}

/** The live record — `publishWebGpuProbe` carries it onto every probe it writes. */
export function getPassStatuses(): PassStatusRecord {
    return statuses;
}
