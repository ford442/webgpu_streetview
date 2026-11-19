/**
 * Deterministic frame stepping for the offline film export (#374 slice 1).
 *
 * `xr/frameClock.ts`'s virtual source runs one app frame per step at an exact
 * time; this module decides *when* a step may run and when its frame is done:
 *
 *   await inputs ready ──▶ stepFrameTo(t₀ + n·dt) ──▶ await GPU idle ──▶ caller captures
 *
 * "Inputs ready" means everything the next frame would otherwise show half
 * of, because it arrives on its own (real-time) schedule:
 *  - the hold is down: a hop's hold-pause releases on the Maps canvas's
 *    stability gate (`panoramaStability.ts`, real time). While it is up the
 *    live canvas must not be uploaded, so the stepper **waits** — it never
 *    steps a held frame, and a hop costs zero film time beyond its crossfade;
 *  - scene depth and the semantic layer have no work in flight (a model
 *    download, an inference, a lazy chunk) — or, past `mapsTimeoutMs`, are
 *    explicitly skipped for this frame and reported so;
 *  - the Maps canvas's tiles have settled: two consecutive fresh
 *    fingerprints `tileIntervalMs` apart agree (past `tilesTimeoutMs` the
 *    frame goes ahead and says so).
 *
 * Waiting runs on the real clock (`sleep` / `now`, injectable for tests);
 * only stepping moves app time. A hold that never releases is an error, not
 * a skip: a film must not freeze on a held frame.
 */
import type { FrameInputsState, FrameInputWork } from '../../types/frameInputs';
import { beginVirtualFrames, endVirtualFrames, frameNow, stepFrameTo } from '../../xr/frameClock';

/** Where readiness is read from — the renderer and the Maps frame source, wired by the caller. */
export interface FrameReadinessSource {
    /** `StreetViewRenderer.frameInputs()`. */
    inputs(): FrameInputsState;
    /**
     * A **fresh** fingerprint of the Maps canvas (`MapsCanvasSource.fingerprint`
     * with `maxAgeMs: 0`; '' = none or blank). Omit when there is no live
     * source (weather-only frames): tiles are then not checked.
     */
    tilesFingerprint?(): Promise<string>;
    /** `StreetViewRenderer.whenGpuIdle()`. */
    gpuIdle(): Promise<void>;
}

export interface FrameReadinessOptions {
    /** Real-time poll interval while waiting (ms). */
    pollMs?: number;
    /** A hold still up after this long fails the step (ms). */
    holdTimeoutMs?: number;
    /** Depth / semantic work still busy after this long is skipped for the frame (ms). */
    mapsTimeoutMs?: number;
    /** Spacing of the two fingerprints that must agree (ms). */
    tileIntervalMs?: number;
    /** Tiles still changing after this long: the frame goes ahead, reported as `timeout` (ms). */
    tilesTimeoutMs?: number;
    /** Real-time sleep; tests inject a fake. */
    sleep?: (ms: number) => Promise<void>;
    /** Real (wall) clock for the timeouts; tests inject a fake. */
    now?: () => number;
}

export const FRAME_READINESS_DEFAULTS = {
    pollMs: 16,
    holdTimeoutMs: 10_000,
    mapsTimeoutMs: 5_000,
    tileIntervalMs: 50,
    tilesTimeoutMs: 2_000,
} as const;

/** How a scene map stood when the frame was allowed to run. */
type FrameMapReadiness = 'off' | 'ready' | 'skipped';

export interface FrameReadinessReport {
    /** Real time spent waiting (ms). */
    waitedMs: number;
    /** Polls of `inputs()` (≥ 1). */
    polls: number;
    depth: FrameMapReadiness;
    semantic: FrameMapReadiness;
    /** `unchecked` = no live source to fingerprint. */
    tiles: 'settled' | 'timeout' | 'unchecked';
}

export class FrameReadinessError extends Error {
    public readonly reason: 'hold-timeout';

    constructor(reason: 'hold-timeout', message: string) {
        super(message);
        this.name = 'FrameReadinessError';
        this.reason = reason;
    }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function mapReadiness(work: FrameInputWork, skipped: boolean): FrameMapReadiness {
    if (work === 'off') return 'off';
    return work === 'busy' && skipped ? 'skipped' : 'ready';
}

/**
 * Wait until the next frame's asynchronous inputs are in (see the module
 * comment). Resolves with how each stood; rejects only on a hold timeout.
 */
export async function awaitFrameInputs(
    source: FrameReadinessSource,
    options: FrameReadinessOptions = {},
): Promise<FrameReadinessReport> {
    const pollMs = options.pollMs ?? FRAME_READINESS_DEFAULTS.pollMs;
    const holdTimeoutMs = options.holdTimeoutMs ?? FRAME_READINESS_DEFAULTS.holdTimeoutMs;
    const mapsTimeoutMs = options.mapsTimeoutMs ?? FRAME_READINESS_DEFAULTS.mapsTimeoutMs;
    const tileIntervalMs = options.tileIntervalMs ?? FRAME_READINESS_DEFAULTS.tileIntervalMs;
    const tilesTimeoutMs = options.tilesTimeoutMs ?? FRAME_READINESS_DEFAULTS.tilesTimeoutMs;
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? defaultNow;

    const start = now();
    let polls = 0;
    let skipDepth = false;
    let skipSemantic = false;
    let tiles: FrameReadinessReport['tiles'] = 'unchecked';
    let tilesDone = !source.tilesFingerprint;
    let tilesStart = start;
    let lastFingerprint: string | null = null;

    for (;;) {
        const inputs = source.inputs();
        polls += 1;
        const elapsed = now() - start;

        if (inputs.holdActive) {
            if (elapsed >= holdTimeoutMs) {
                throw new FrameReadinessError(
                    'hold-timeout',
                    `the hold-pause is still up after ${Math.round(elapsed)} ms — a film never steps a held frame`,
                );
            }
            // The canvas behind the hold is a new pano: its tiles start over.
            if (source.tilesFingerprint) {
                tilesDone = false;
                tiles = 'unchecked';
                lastFingerprint = null;
            }
            await sleep(pollMs);
            tilesStart = now();
            continue;
        }

        const depthBusy = inputs.depth === 'busy' && !skipDepth;
        const semanticBusy = inputs.semantic === 'busy' && !skipSemantic;
        if (depthBusy || semanticBusy) {
            if (elapsed < mapsTimeoutMs) {
                await sleep(pollMs);
                continue;
            }
            if (depthBusy) skipDepth = true;
            if (semanticBusy) skipSemantic = true;
        }

        if (!tilesDone && source.tilesFingerprint) {
            const fingerprint = await source.tilesFingerprint();
            if (fingerprint !== '' && fingerprint === lastFingerprint) {
                tilesDone = true;
                tiles = 'settled';
            } else if (now() - tilesStart >= tilesTimeoutMs) {
                tilesDone = true;
                tiles = 'timeout';
            } else {
                lastFingerprint = fingerprint;
                await sleep(tileIntervalMs);
                continue;
            }
        }

        // The awaits above ran real time: a hop may have put the hold up meanwhile.
        const final = source.inputs();
        polls += 1;
        if (final.holdActive) continue;
        return {
            waitedMs: now() - start,
            polls,
            depth: mapReadiness(final.depth, skipDepth),
            semantic: mapReadiness(final.semantic, skipSemantic),
            tiles,
        };
    }
}

export interface VirtualFrameStepperOptions extends FrameReadinessOptions {
    /** Frames per second of app time; each step advances exactly `1000 / fps` ms. */
    fps: number;
    /** App time of frame 0 (ms); default: `frameNow()` when the stepper begins. */
    startMs?: number;
}

export interface FrameStepReport extends FrameReadinessReport {
    /** 1-based index of the frame just run. */
    frame: number;
    /** Its app time (ms) — `startMs + frame · 1000 / fps`, computed, never accumulated. */
    timeMs: number;
    /** Frame-clock callbacks that ran (the road loop, the car loop, crossfades…). */
    callbacks: number;
}

/**
 * Owns the virtual clock for one export: `begin` takes frames off the window,
 * each `step()` runs one frame when its inputs are in, `end()` hands frames
 * back. Always `end()` in a `finally` — until then the app does not animate.
 */
export class VirtualFrameStepper {
    private frame = 0;
    private stepping = false;
    private ended = false;
    private readonly startMs: number;
    private readonly frameMs: number;

    private constructor(
        private readonly source: FrameReadinessSource,
        private readonly options: VirtualFrameStepperOptions,
    ) {
        if (!(Number.isFinite(options.fps) && options.fps > 0)) {
            throw new RangeError(`[VirtualFrameStepper] fps must be a positive number (got ${options.fps})`);
        }
        this.frameMs = 1000 / options.fps;
        this.startMs = options.startMs ?? frameNow();
    }

    /** Take frames off the window / XR clock. Throws while an XR session presents. */
    public static begin(source: FrameReadinessSource, options: VirtualFrameStepperOptions): VirtualFrameStepper {
        const stepper = new VirtualFrameStepper(source, options);
        beginVirtualFrames(stepper.startMs);
        return stepper;
    }

    /** Frames run so far. */
    public get frames(): number {
        return this.frame;
    }

    /** Wait for the inputs, run the next frame at its exact time, and wait for the GPU to finish it. */
    public async step(): Promise<FrameStepReport> {
        if (this.ended) throw new Error('[VirtualFrameStepper] stepped after end()');
        if (this.stepping) throw new Error('[VirtualFrameStepper] a step is already running');
        this.stepping = true;
        try {
            const readiness = await awaitFrameInputs(this.source, this.options);
            if (this.ended) throw new Error('[VirtualFrameStepper] ended while waiting for a frame');
            const frame = this.frame + 1;
            const timeMs = this.startMs + frame * this.frameMs;
            const callbacks = stepFrameTo(timeMs);
            this.frame = frame;
            await this.source.gpuIdle();
            return { ...readiness, frame, timeMs, callbacks };
        } finally {
            this.stepping = false;
        }
    }

    /** Hand frames back to the window; app time carries on from the last frame. Idempotent. */
    public end(): void {
        if (this.ended) return;
        this.ended = true;
        endVirtualFrames();
    }
}
