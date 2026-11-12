/**
 * The app's one `AudioContext` (#361 slice 4), with named buses.
 *
 * The cabin engine, the car radio, the convertible wind bed and the science
 * lab's fan used to create a context each — up to three on separate clocks in
 * one car session, each with its own audio thread, against Chrome's cap on
 * concurrent contexts. Everything now connects to a bus here:
 *
 *   cabin ─┐
 *   radio ─┤
 *   wind  ─┼─► master gain ─► limiter (DynamicsCompressor) ─► destination
 *   ui    ─┤
 *   voice ─┘   (empty: convoy / copilot voice, #343 / #354)
 *
 * This module owns the only `createBrowserAudioContext()` call; an ESLint
 * `no-restricted-syntax` rule forbids `new AudioContext` anywhere else and
 * `runtime/contexts.scan.test.ts` checks both.
 *
 * Lifecycle: reference-counted. The last `releaseAudioRuntime()` suspends the
 * context (never closes it — a later user resumes it). A hidden page suspends
 * it too; becoming visible, or the next user gesture, resumes it while it has
 * users. The output's sample rate and latency go to `__SV__.contexts.audio`.
 */
import { createBrowserAudioContext } from './createAudioContext';
import { ignoreRejection } from '../config/ignoreRejection';
import { recordAudioOutput } from '../runtime/contexts';

export const AUDIO_BUS_NAMES = ['cabin', 'radio', 'wind', 'ui', 'voice'] as const;
export type AudioBusName = (typeof AUDIO_BUS_NAMES)[number];

export interface AudioRuntime {
    readonly ctx: AudioContext;
    /** One `GainNode` per bus, each into the master. Connect sources here, never to `destination`. */
    readonly buses: Readonly<Record<AudioBusName, GainNode>>;
    readonly master: GainNode;
    /**
     * A brick-wall-ish limiter: summed buses must not clip. Null only where the
     * implementation has no `DynamicsCompressorNode` (master goes straight out).
     */
    readonly limiter: DynamicsCompressorNode | null;
}

/** Limiter settings: transparent below -1 dBFS, a fast hard knee above. */
const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.1 } as const;

let runtime: AudioRuntime | null = null;
let users = 0;
const mutes = new Map<AudioBusName, Set<string>>();
let lifecycleInstalled = false;

function buildRuntime(): AudioRuntime {
    const ctx = createBrowserAudioContext();
    const master = ctx.createGain();
    let limiter: DynamicsCompressorNode | null = null;
    if (typeof ctx.createDynamicsCompressor === 'function') {
        limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = LIMITER.threshold;
        limiter.knee.value = LIMITER.knee;
        limiter.ratio.value = LIMITER.ratio;
        limiter.attack.value = LIMITER.attack;
        limiter.release.value = LIMITER.release;
        master.connect(limiter);
        limiter.connect(ctx.destination);
    } else {
        master.connect(ctx.destination);
    }
    const buses = {} as Record<AudioBusName, GainNode>;
    for (const name of AUDIO_BUS_NAMES) {
        const bus = ctx.createGain();
        bus.connect(master);
        buses[name] = bus;
    }
    recordAudioOutput(ctx);
    return { ctx, buses, master, limiter };
}

/** Guarded: a minimal implementation (or a test stub) may lack suspend/resume. */
function suspendContext(ctx: AudioContext): void {
    if (ctx.state === 'running' && typeof ctx.suspend === 'function') void ctx.suspend().catch(ignoreRejection);
}

function resumeContext(ctx: AudioContext): void {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') void ctx.resume().catch(ignoreRejection);
}

function resumeIfUsed(): void {
    if (!runtime || users === 0) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    resumeContext(runtime.ctx);
}

function installLifecycle(): void {
    if (lifecycleInstalled || typeof document === 'undefined') return;
    lifecycleInstalled = true;
    document.addEventListener('visibilitychange', () => {
        if (!runtime) return;
        if (document.visibilityState === 'hidden') {
            suspendContext(runtime.ctx);
        } else {
            resumeIfUsed();
        }
    });
    // Autoplay policy: a context made before a gesture starts suspended.
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
        window.addEventListener(type, resumeIfUsed, { capture: true, passive: true });
    }
}

/**
 * Take a reference on the shared context, creating it (and its buses) on
 * first use and resuming it if suspended. Null when Web Audio is unavailable.
 * Pair every successful call with {@link releaseAudioRuntime}.
 */
export function acquireAudioRuntime(): AudioRuntime | null {
    if (!runtime) {
        try {
            runtime = buildRuntime();
            // Mutes requested before the context existed.
            for (const name of AUDIO_BUS_NAMES) if (isAudioBusMuted(name)) runtime.buses[name].gain.value = 0;
        } catch (err) {
            console.warn('[audioRuntime] Web Audio unavailable', err);
            return null;
        }
        installLifecycle();
    }
    users += 1;
    resumeIfUsed();
    return runtime;
}

/** Drop a reference; the last one suspends the context (never closes it). */
export function releaseAudioRuntime(): void {
    if (!runtime || users === 0) return;
    users -= 1;
    if (users === 0) suspendContext(runtime.ctx);
}

/**
 * Mute a bus on behalf of `owner` (several owners may hold one bus muted);
 * unmuted when every owner has let go. Ramped, so a mute never clicks.
 */
export function setAudioBusMuted(name: AudioBusName, owner: string, muted: boolean): void {
    let owners = mutes.get(name);
    if (!owners) {
        owners = new Set();
        mutes.set(name, owners);
    }
    if (muted) owners.add(owner);
    else owners.delete(owner);
    applyMute(name);
}

export function isAudioBusMuted(name: AudioBusName): boolean {
    return (mutes.get(name)?.size ?? 0) > 0;
}

function applyMute(name: AudioBusName): void {
    const bus = runtime?.buses[name];
    if (!bus) return;
    const target = isAudioBusMuted(name) ? 0 : 1;
    try {
        bus.gain.setTargetAtTime(target, runtime!.ctx.currentTime, 0.02);
    } catch {
        bus.gain.value = target;
    }
}

/**
 * Live `AudioContext`s this module has made — 0 or 1. `__CABIN_AUDIO_PROBE__.contexts`
 * reports it; anything above 1 is a regression of #361.
 */
export function audioContextCount(): number {
    return runtime && runtime.ctx.state !== 'closed' ? 1 : 0;
}

/** Test-only: forget the runtime (the next acquire builds a fresh one). */
export function resetAudioRuntimeForTests(): void {
    runtime = null;
    users = 0;
    mutes.clear();
}
