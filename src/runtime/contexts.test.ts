// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getRuntimeContexts,
    readBatteryState,
    readDisplayCapabilities,
    recordAudioOutput,
    recordGpuContext,
    refreshHzFromFrameTimes,
    resetRuntimeContextsForTests,
    startRuntimeContexts,
    subscribeDisplayChanges,
} from './contexts';

type Listener = () => void;

function installMatchMedia(state: { hdr: boolean; p3: boolean }) {
    const listeners = new Map<string, Set<Listener>>();
    const matchMedia = vi.fn((query: string) => ({
        get matches() {
            return query.includes('dynamic-range') ? state.hdr : query.includes('color-gamut') ? state.p3 : false;
        },
        media: query,
        addEventListener: (_: string, fn: Listener) => {
            if (!listeners.has(query)) listeners.set(query, new Set());
            listeners.get(query)!.add(fn);
        },
        removeEventListener: (_: string, fn: Listener) => listeners.get(query)?.delete(fn),
    }));
    Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
    return {
        fire() {
            for (const set of listeners.values()) for (const fn of set) fn();
        },
    };
}

beforeEach(() => {
    resetRuntimeContextsForTests();
});

afterEach(() => {
    resetRuntimeContextsForTests();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'matchMedia');
    Reflect.deleteProperty(navigator, 'getBattery');
});

describe('runtime contexts (#361)', () => {
    it('is a frozen snapshot', () => {
        const contexts = getRuntimeContexts();
        expect(Object.isFrozen(contexts)).toBe(true);
        expect(Object.isFrozen(contexts.display)).toBe(true);
        expect(contexts.gpu).toBeNull();
    });

    it('reads the display through matchMedia and follows a monitor change', () => {
        const state = { hdr: false, p3: false };
        const media = installMatchMedia(state);
        resetRuntimeContextsForTests();
        expect(readDisplayCapabilities()).toEqual({ hdr: false, p3: false });
        startRuntimeContexts();
        const seen: boolean[] = [];
        subscribeDisplayChanges((display) => seen.push(display.hdr));
        state.hdr = true;
        media.fire();
        expect(getRuntimeContexts().display.hdr).toBe(true);
        expect(seen[0]).toBe(true);
    });

    it('reads the battery once and keeps it current', async () => {
        const battery = { charging: false, level: 0.15, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        const getBattery = vi.fn(() => Promise.resolve(battery));
        Object.defineProperty(navigator, 'getBattery', { value: getBattery, configurable: true });
        expect(await readBatteryState()).toEqual({ charging: false, level: 0.15 });
        await readBatteryState();
        expect(getBattery).toHaveBeenCalledTimes(1);
        expect(getRuntimeContexts().power.battery).toEqual({ charging: false, level: 0.15 });
        battery.charging = true;
        const onChange = battery.addEventListener.mock.calls.find((c) => c[0] === 'chargingchange')![1] as Listener;
        onChange();
        expect(getRuntimeContexts().power.battery?.charging).toBe(true);
    });

    it('a browser without the Battery API reads null', async () => {
        expect(await readBatteryState()).toBeNull();
        expect(getRuntimeContexts().power.battery).toBeNull();
    });

    it('records the road adapter and the audio output', () => {
        const adapter = {
            info: { vendor: 'nvidia', architecture: 'ampere', device: '', description: 'RTX' },
            features: new Set(['subgroups', 'shader-f16']),
            limits: { maxTextureDimension2D: 16384 },
        } as unknown as GPUAdapter;
        recordGpuContext(adapter, { powerPreference: 'high-performance' }, ['subgroups']);
        const gpu = getRuntimeContexts().gpu!;
        expect(gpu.adapterInfo.vendor).toBe('nvidia');
        expect(gpu.features).toEqual(['shader-f16', 'subgroups']);
        expect(gpu.enabledFeatures).toEqual(['subgroups']);
        expect(gpu.limits.maxTextureDimension2D).toBe(16384);
        expect(gpu.featureLevel).toBe('unknown');
        expect(gpu.xrCompatible).toBe(false);

        recordAudioOutput({ sampleRate: 48000, baseLatency: 0.01 });
        expect(getRuntimeContexts().audio).toEqual({ sampleRate: 48000, baseLatency: 0.01, outputLatency: null });
    });

    it('measures the refresh rate from frame times (median interval)', () => {
        const at60 = Array.from({ length: 31 }, (_, i) => i * (1000 / 60));
        expect(refreshHzFromFrameTimes(at60)).toBe(60);
        // One long frame (a GC pause) does not move the median.
        const at120 = Array.from({ length: 31 }, (_, i) => i * (1000 / 120) + (i > 20 ? 50 : 0));
        expect(refreshHzFromFrameTimes(at120)).toBe(120);
        expect(refreshHzFromFrameTimes([0])).toBeNull();
    });
});
