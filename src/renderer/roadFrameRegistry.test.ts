/**
 * The road → cabin handoff: what the windshield portal is allowed to see of the
 * road frame, and how a renderer's lifetime maps onto the single slot.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    createNeutralRoadLook,
    createRoadFrameSource,
    getRoadFrameSource,
    publishRoadFrameSource,
    readRoadLookInto,
    resetRoadFrameSourceForTests,
    retractRoadFrameSource,
    type RoadFrameSource,
    type RoadFrameSourceDeps,
} from './roadFrameRegistry';
import { WEATHER_PARAMS_FLOAT_COUNT, WeatherParamIndex } from './weatherUniformLayout';

afterEach(() => resetRoadFrameSourceForTests());

const fakeTexture = { label: 'intermediate' } as unknown as GPUTexture;
const fakeDevice = { label: 'shared device' } as unknown as GPUDevice;

function deps(overrides: Partial<RoadFrameSourceDeps> = {}): RoadFrameSourceDeps {
    return {
        getDevice: () => fakeDevice,
        getIntermediate: () => ({ texture: fakeTexture, format: 'rg11b10ufloat', width: 640, height: 360 }),
        isHoldActive: () => false,
        getLook: () => createNeutralRoadLook(),
        isAlive: () => true,
        ...overrides,
    };
}

describe('readRoadLookInto', () => {
    it('reads every mirrored field from the packed 40-float block, by WeatherParamIndex', () => {
        const params = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
        const I = WeatherParamIndex;
        params[I.vibrance] = 0.25;
        params[I.saturation] = -0.5;
        params[I.contrast] = 0.75;
        params[I.exposure] = 1.5;
        params[I.temperature] = -0.25;
        params[I.tint] = 0.125;
        params[I.nightIntensity] = 0.5;
        params[I.rainIntensity] = 1.25;
        params[I.shaderEffectsEnabled] = 1;

        expect(readRoadLookInto(params, createNeutralRoadLook())).toEqual({
            vibrance: 0.25,
            saturation: -0.5,
            contrast: 0.75,
            exposure: 1.5,
            temperature: -0.25,
            tint: 0.125,
            nightIntensity: 0.5,
            rainIntensity: 1.25,
            graded: true,
        });
    });

    it('treats shaderEffectsEnabled below 0.5 as the ungraded bypass', () => {
        const params = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
        params[WeatherParamIndex.shaderEffectsEnabled] = 0;
        expect(readRoadLookInto(params, createNeutralRoadLook()).graded).toBe(false);
        params[WeatherParamIndex.shaderEffectsEnabled] = 1;
        expect(readRoadLookInto(params, createNeutralRoadLook()).graded).toBe(true);
    });

    it('leaves later fields alone when handed only the six colour knobs (updateColorParams)', () => {
        const look = createNeutralRoadLook();
        look.nightIntensity = 0.9;
        look.rainIntensity = 0.4;
        look.graded = false;
        readRoadLookInto(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), look);
        expect(look.exposure).toBeCloseTo(0.4);
        expect(look.tint).toBeCloseTo(0.6);
        expect(look.nightIntensity).toBe(0.9);
        expect(look.rainIntensity).toBe(0.4);
        expect(look.graded).toBe(false);
    });

    it('does not allocate: it fills the object it is given', () => {
        const look = createNeutralRoadLook();
        expect(readRoadLookInto(new Float32Array(WEATHER_PARAMS_FLOAT_COUNT), look)).toBe(look);
    });
});

describe('createRoadFrameSource', () => {
    it('hands over the intermediate texture, its format, and its size', () => {
        const frame = createRoadFrameSource(deps()).getFrame();
        expect(frame).not.toBeNull();
        expect(frame!.texture).toBe(fakeTexture);
        expect(frame!.format).toBe('rg11b10ufloat');
        expect(frame!.width).toBe(640);
        expect(frame!.height).toBe(360);
    });

    it('exposes exactly the intermediate and its metadata — nothing that could be a live Maps upload', () => {
        // The hold-pause guarantee is structural: the only texture on the frame is the
        // pass-1 intermediate, which during a hold is drawn from the frozen snapshot.
        // If a future change adds a field here, this test forces it to be reviewed.
        const frame = createRoadFrameSource(deps()).getFrame()!;
        expect(Object.keys(frame).sort()).toEqual(
            ['device', 'format', 'height', 'held', 'look', 'texture', 'width'],
        );
    });

    it('says which device owns the texture, so a cabin on another device can refuse it', () => {
        expect(createRoadFrameSource(deps()).getFrame()!.device).toBe(fakeDevice);
    });

    it('reports the hold-pause state without changing which texture is offered', () => {
        let held = false;
        const source = createRoadFrameSource(deps({ isHoldActive: () => held }));
        expect(source.getFrame()!.held).toBe(false);
        held = true;
        const frame = source.getFrame()!;
        expect(frame.held).toBe(true);
        expect(frame.texture).toBe(fakeTexture);
    });

    it('is null before the renderer has created an intermediate', () => {
        const source = createRoadFrameSource(
            deps({ getIntermediate: () => ({ texture: undefined, format: 'rgba16float', width: 0, height: 0 }) }),
        );
        expect(source.getFrame()).toBeNull();
    });

    it('is null for a zero-sized intermediate', () => {
        const source = createRoadFrameSource(
            deps({ getIntermediate: () => ({ texture: fakeTexture, format: 'rgba16float', width: 0, height: 360 }) }),
        );
        expect(source.getFrame()).toBeNull();
    });

    it('is null once the renderer is torn down, even if its texture object still exists', () => {
        let alive = true;
        const source = createRoadFrameSource(deps({ isAlive: () => alive }));
        expect(source.getFrame()).not.toBeNull();
        alive = false;
        expect(source.getFrame()).toBeNull();
    });

    it('follows the renderer when it replaces its intermediate (resize): read fresh, never cached', () => {
        let current = { label: 'a' } as unknown as GPUTexture;
        const source = createRoadFrameSource(
            deps({ getIntermediate: () => ({ texture: current, format: 'rgba16float', width: 8, height: 8 }) }),
        );
        expect(source.getFrame()!.texture).toBe(current);
        const next = { label: 'b' } as unknown as GPUTexture;
        current = next;
        expect(source.getFrame()!.texture).toBe(next);
    });
});

describe('road frame slot', () => {
    const source = (): RoadFrameSource => ({ getFrame: () => null });

    it('is empty by default', () => {
        expect(getRoadFrameSource()).toBeNull();
    });

    it('publish replaces whatever was there', () => {
        const a = source();
        const b = source();
        publishRoadFrameSource(a);
        publishRoadFrameSource(b);
        expect(getRoadFrameSource()).toBe(b);
    });

    it('retracts its own source', () => {
        const a = source();
        publishRoadFrameSource(a);
        retractRoadFrameSource(a);
        expect(getRoadFrameSource()).toBeNull();
    });

    it('does not retract a newer renderer\'s source (device-lost re-init ordering)', () => {
        // New renderer publishes before the old one's teardown runs.
        const oldSource = source();
        const newSource = source();
        publishRoadFrameSource(oldSource);
        publishRoadFrameSource(newSource);
        retractRoadFrameSource(oldSource);
        expect(getRoadFrameSource()).toBe(newSource);
    });

    it('retracting null is a no-op', () => {
        const a = source();
        publishRoadFrameSource(a);
        retractRoadFrameSource(null);
        expect(getRoadFrameSource()).toBe(a);
    });
});
