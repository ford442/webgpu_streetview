import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGpuGlobals } from '../renderer/computeWeather/__tests__/fakeGpu';
import { povStore } from '../state/povStore';
import { cabinHeadStore } from '../state/cabinHeadStore';
import { cabinHeadOffsetStore } from '../state/cabinHeadOffsetStore';
import { getCabinStereoRequest, publishCabinStereoRequest, resetCabinStereoRequestForTests } from '../renderer/cabinStereoRequest';
import {
    getXrPresentFrame,
    isXrPresenting,
    noteXrFramePresented,
    resetXrPresentFrameForTests,
    setXrRepresentHandler,
    type XrPresentFrame,
} from '../renderer/xrPresentFrame';
import { frameTailScheduler } from '../renderer/reproject/frameTail';
import { isXrDriven, requestFrame, resetFrameClockForTests } from './frameClock';
import { setXrCabinInputListener, type XrCabinInputEvent } from './xrCabinInput';
import { resetXrCockpitForTests, startXrCockpit, XrUnavailableError } from './xrSession';

installGpuGlobals();

const DEG = Math.PI / 180;

function quat(yawDeg: number, pitchDeg: number) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchDeg * DEG, yawDeg * DEG, 0, 'YXZ'));
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

const projection = new Float32Array(new THREE.Matrix4().makePerspective(-0.1, 0.1, 0.1, -0.1, 0.1, 100).elements);

function view(eye: 'left' | 'right', x: number, head: { position: { x: number; y: number; z: number }; orientation: ReturnType<typeof quat> }) {
    return {
        eye,
        projectionMatrix: projection,
        transform: { position: { ...head.position, x: head.position.x + x }, orientation: head.orientation },
    };
}

function fakeXr(options: { enabledFeatures?: string[] } = {}) {
    const listeners = new Map<string, Array<(e: unknown) => void>>();
    let frameCallback: ((t: number, f: unknown) => void) | null = null;
    const texture = { label: 'xr-color' };
    const session = {
        enabledFeatures: options.enabledFeatures ?? ['webgpu', 'local'],
        inputSources: [] as unknown[],
        requestAnimationFrame: (cb: (t: number, f: unknown) => void) => {
            frameCallback = cb;
            return 1;
        },
        updateRenderState: vi.fn(async () => undefined),
        requestReferenceSpace: vi.fn(async () => ({ kind: 'local' })),
        addEventListener: (type: string, cb: (e: unknown) => void) => {
            listeners.set(type, [...(listeners.get(type) ?? []), cb]);
        },
        end: vi.fn(async () => {
            for (const cb of listeners.get('end') ?? []) cb({});
            listeners.delete('end');
        }),
    };
    let head = { position: { x: 0.1, y: 1.2, z: -0.3 }, orientation: quat(0, 0) };
    const Binding = class {
        constructor(public s: unknown, public d: unknown) {}
        getPreferredColorFormat() { return 'rgba8unorm'; }
        createProjectionLayer = vi.fn(() => ({ kind: 'layer' }));
        getViewSubImage(_layer: unknown, v: { eye: string }) {
            const layerIndex = v.eye === 'left' ? 0 : 1;
            return {
                colorTexture: { ...texture, createView: (d: unknown) => ({ kind: 'view', d }) },
                getViewDescriptor: () => ({ dimension: '2d', baseArrayLayer: layerIndex, arrayLayerCount: 1 }),
                viewport: { x: 0, y: 0, width: 200, height: 180 },
            };
        }
    };
    // One colour texture object per eye call above, so `clear` keys on the layer index.
    const tick = (t: number) => {
        const cb = frameCallback!;
        frameCallback = null;
        cb(t, {
            getViewerPose: () => ({
                transform: head,
                views: [view('left', -0.032, head), view('right', 0.032, head)],
            }),
            getPose: () => ({ transform: { position: head.position, orientation: head.orientation } }),
        });
    };
    let lose!: () => void;
    const device = { lost: new Promise<void>((resolve) => { lose = resolve; }) } as unknown as GPUDevice;
    return {
        session,
        Binding: Binding as unknown as typeof XRGPUBinding,
        xr: { requestSession: vi.fn(async () => session as unknown as XRSession) },
        device,
        tick,
        lose: () => lose(),
        setHead: (next: typeof head) => { head = next; },
        fire: (type: string, e: unknown) => (listeners.get(type) ?? []).forEach((cb) => cb(e)),
    };
}

let machine: XrCabinInputEvent[];

beforeEach(() => {
    machine = [];
    setXrCabinInputListener((e) => machine.push(e));
    povStore.reset({ heading: 10, carHeading: 10, pitch: 0, zoom: 2.5 });
    cabinHeadStore.reset();
    cabinHeadOffsetStore.reset();
    resetCabinStereoRequestForTests();
    resetXrPresentFrameForTests();
    frameTailScheduler.reset();
});
afterEach(() => {
    setXrCabinInputListener(null);
    resetFrameClockForTests();
    resetXrCockpitForTests();
});

describe('WebXR cockpit session', () => {
    it('enters through the input machine, drives the frame loops, and presents both eyes from inside the XR frame', async () => {
        const f = fakeXr();
        const desktopStereo = { kind: 'sbs' as const, ipd: 0.064, convergence: 1 };
        publishCabinStereoRequest(desktopStereo);
        const cockpit = await startXrCockpit({ device: f.device, xr: f.xr, Binding: f.Binding });
        expect(f.xr.requestSession).toHaveBeenCalledWith('immersive-vr', { optionalFeatures: ['webgpu'] });
        expect(machine).toEqual([{ type: 'XR_ENTER' }]);
        expect(isXrPresenting()).toBe(true);
        expect(isXrDriven()).toBe(true);
        expect(povStore.get().zoom).toBe(1);

        // An app loop, as WebGPUCanvas / the car loop schedule themselves.
        const seen: Array<{ time: number; frame: XrPresentFrame | null }> = [];
        const loop = (time: number) => {
            seen.push({ time, frame: getXrPresentFrame() });
            noteXrFramePresented(); // the tail drew the eyes
            requestFrame(loop);
        };
        requestFrame(loop);

        f.setHead({ position: { x: 0.15, y: 1.2, z: -0.3 }, orientation: quat(20, -10) });
        f.tick(1000);
        // First pose re-centres: this lean is relative to it.
        expect(cabinHeadOffsetStore.get()).toEqual({ x: 0, y: 0, z: 0 });
        f.setHead({ position: { x: 0.2, y: 1.2, z: -0.3 }, orientation: quat(20, -10) });
        f.tick(1011);
        expect(seen.map((s) => s.time)).toEqual([1000, 1011]);
        expect(cabinHeadStore.get().headYaw).toBeCloseTo(20 * DEG, 6);
        expect(cabinHeadStore.get().headPitch).toBeCloseTo(-10 * DEG, 6);
        expect(cabinHeadOffsetStore.get().x).toBeCloseTo(0.05, 6);

        const presented = seen[1]!.frame!;
        expect(presented.format).toBe('rgba8unorm');
        expect(presented.halfIpd).toBeCloseTo(0.032, 6);
        expect(presented.eyes.map((e) => [e.eyeSign, e.clear])).toEqual([[-1, true], [1, true]]);
        expect(presented.eyes[0]!.frustum.left).toBeCloseTo(-1, 6);
        // Retracted once the frame is over: sub-images are dead after the callback.
        expect(getXrPresentFrame()).toBeNull();
        const request = getCabinStereoRequest();
        expect(request?.kind).toBe('views');

        await cockpit.end();
        expect(await cockpit.ended).toBe('user');
        expect(machine.at(-1)).toEqual({ type: 'XR_EXIT' });
        expect(isXrPresenting()).toBe(false);
        expect(isXrDriven()).toBe(false);
        expect(povStore.get().zoom).toBe(2.5);
        expect(cabinHeadStore.get()).toEqual({ headYaw: 0, headPitch: 0 });
        expect(cabinHeadOffsetStore.get()).toEqual({ x: 0, y: 0, z: 0 });
        expect(getCabinStereoRequest()).toBe(desktopStereo);
    });

    it('the left thumbstick goes to the machine as XR_STICK, with the frame time', async () => {
        const f = fakeXr();
        await startXrCockpit({ device: f.device, xr: f.xr, Binding: f.Binding });
        f.session.inputSources = [
            { handedness: 'left', gamepad: { axes: [0, 0, 0.8, 0] } },
            { handedness: 'right', gamepad: { axes: [0, 0, -1, 0] } },
        ];
        f.tick(100);
        f.tick(114);
        const sticks = machine.filter((e) => e.type === 'XR_STICK');
        expect(sticks).toEqual([
            { type: 'XR_STICK', axisX: 0.8, dtS: 0 },
            { type: 'XR_STICK', axisX: 0.8, dtS: 0.014 },
        ]);
    });

    it('a frame with no road frame re-presents the last one; the right hand presses along its ray', async () => {
        const f = fakeXr();
        const represent = vi.fn();
        setXrRepresentHandler(represent);
        const pressAlongRay = vi.fn(() => true);
        await startXrCockpit({ device: f.device, xr: f.xr, Binding: f.Binding, pressAlongRay });
        f.tick(1);
        expect(represent).toHaveBeenCalledTimes(1);
        const right = { handedness: 'right', targetRaySpace: {} };
        f.fire('select', { inputSource: right, frame: { getPose: () => ({ transform: { position: { x: 0.1, y: 1.0, z: -0.3 }, orientation: quat(0, 0) } }) } });
        const [origin, dir] = pressAlongRay.mock.calls[0] as unknown as [{ y: number }, { x: number; y: number; z: number }];
        expect(origin.y).toBeCloseTo(-0.2, 6); // below the eye point
        expect(dir.z).toBeCloseTo(-1, 6); // straight ahead, at the dash
        f.fire('select', { inputSource: { handedness: 'left', targetRaySpace: {} }, frame: {} });
        expect(pressAlongRay).toHaveBeenCalledTimes(1);
    });

    it('a lost device ends the session and 2D takes the loops back', async () => {
        const f = fakeXr();
        const cockpit = await startXrCockpit({ device: f.device, xr: f.xr, Binding: f.Binding });
        f.lose();
        expect(await cockpit.ended).toBe('device-lost');
        expect(f.session.end).toHaveBeenCalled();
        expect(isXrDriven()).toBe(false);
        expect(machine.at(-1)).toEqual({ type: 'XR_EXIT' });
    });

    it('says honestly what is missing', async () => {
        const f = fakeXr({ enabledFeatures: ['local'] });
        await expect(startXrCockpit({ device: f.device, xr: f.xr, Binding: f.Binding })).rejects.toThrow(/WebGPU-XR/);
        expect(f.session.end).toHaveBeenCalled();
        await expect(startXrCockpit({ device: f.device, xr: f.xr, Binding: undefined as never }))
            .rejects.toBeInstanceOf(XrUnavailableError);
        expect(isXrPresenting()).toBe(false);
        expect(machine).toEqual([]);
    });
});
