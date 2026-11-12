// @vitest-environment jsdom
/**
 * #367 slice 4: one AudioContext for the app. A car session with the cabin
 * engine, the radio and the wind bed playing holds exactly one context, every
 * source reaches `destination` through its bus and the master limiter, and
 * `__CABIN_AUDIO_PROBE__.contexts` says 1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AUDIO_BUS_NAMES,
    acquireAudioRuntime,
    audioContextCount,
    isAudioBusMuted,
    releaseAudioRuntime,
    resetAudioRuntimeForTests,
    setAudioBusMuted,
} from './audioRuntime';
import { acquireCarAudioGraph, attachCabinEngine, resetCarAudioGraphForTests } from './carAudioGraph';
import { AudioAnalyzer } from './AudioAnalyzer';
import { WindAudio } from './WindAudio';
import { publishCabinAudioProbe } from '../car/audio/cabinAudioProbe';
import { getRuntimeContexts, resetRuntimeContextsForTests } from '../runtime/contexts';
import {
    StubNode,
    contexts,
    installStubAudioContext,
    restoreAudioContext,
    type StubAudioContext,
} from './__tests__/stubAudioContext';

vi.mock('../wasm', () => ({
    // The HRTF upgrade is not under test: stay on the panner path.
    loadWasmModule: () => Promise.reject(new Error('no wasm in this test')),
}));

/** The panner WindAudio builds; jsdom's stub context has none, so add one. */
function addPanner(ctx: StubAudioContext) {
    Object.assign(ctx, {
        createStereoPanner: () => Object.assign(new StubNode(), { pan: { value: 0, setTargetAtTime: vi.fn() } }),
        createBiquadFilter: () => Object.assign(new StubNode(), { type: 'lowpass', frequency: { value: 0 } }),
    });
}

beforeEach(() => {
    installStubAudioContext();
    resetAudioRuntimeForTests();
    resetCarAudioGraphForTests();
    resetRuntimeContextsForTests();
    window.__CABIN_AUDIO_PROBE__ = undefined;
});

afterEach(() => {
    restoreAudioContext();
});

describe('audioRuntime', () => {
    it('builds every bus into a master limiter into destination', () => {
        const rt = acquireAudioRuntime()!;
        expect(Object.keys(rt.buses).sort()).toEqual([...AUDIO_BUS_NAMES].sort());
        for (const name of AUDIO_BUS_NAMES) {
            expect((rt.buses[name] as unknown as StubNode).connections.has(rt.master)).toBe(true);
        }
        expect((rt.master as unknown as StubNode).connections.has(rt.limiter)).toBe(true);
        expect((rt.limiter as unknown as StubNode).connections.has(rt.ctx.destination)).toBe(true);
        expect(rt.limiter!.threshold.value).toBe(-1);
        // The output lands on the capability manifest.
        expect(getRuntimeContexts().audio.sampleRate).toBe(48000);
    });

    it('a car session with cabin, radio and wind holds exactly one AudioContext', async () => {
        const car = acquireCarAudioGraph()!;
        const engine = new StubNode();
        attachCabinEngine(engine as unknown as AudioNode, engine as unknown as AudioNode);
        const radio = new AudioAnalyzer({ carCabin: true });
        expect(await radio.init('https://example.test/stream')).toBe(true);
        addPanner(contexts[0]!);
        const wind = new WindAudio();
        expect(await wind.init()).toBe(true);
        expect(contexts).toHaveLength(1);
        expect(audioContextCount()).toBe(1);
        publishCabinAudioProbe({ mode: 'worklet-wasm' });
        expect(window.__CABIN_AUDIO_PROBE__?.contexts).toBe(1);
        // The wind bed is on its bus, which the engine holds muted.
        expect(isAudioBusMuted('wind')).toBe(true);
        expect(car.ctx).toBe(contexts[0]);
        wind.dispose();
        radio.dispose();
        expect(contexts[0]!.close).not.toHaveBeenCalled();
    });

    it('a mute is per owner and survives a runtime made later', () => {
        setAudioBusMuted('voice', 'a', true);
        setAudioBusMuted('voice', 'b', true);
        const rt = acquireAudioRuntime()!;
        expect(rt.buses.voice.gain.value).toBe(0);
        setAudioBusMuted('voice', 'a', false);
        expect(isAudioBusMuted('voice')).toBe(true);
        setAudioBusMuted('voice', 'b', false);
        expect(rt.buses.voice.gain.value).toBe(1);
    });

    it('suspends when hidden or unused, resumes when visible with users', () => {
        const rt = acquireAudioRuntime()!;
        const ctx = rt.ctx as unknown as StubAudioContext;
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(ctx.suspend).toHaveBeenCalledTimes(1);
        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(ctx.resume).toHaveBeenCalled();
        releaseAudioRuntime();
        expect(ctx.suspend).toHaveBeenCalledTimes(2);
        expect(ctx.close).not.toHaveBeenCalled();
        visibility.mockRestore();
    });

    it('is null (and counts 0) without Web Audio', () => {
        (globalThis as unknown as Record<string, unknown>).AudioContext = undefined;
        expect(acquireAudioRuntime()).toBeNull();
        expect(audioContextCount()).toBe(0);
    });
});
