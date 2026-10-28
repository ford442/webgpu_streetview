/**
 * The WebXR cockpit (#331): an `immersive-vr` session on the app's one
 * `GPUDevice`, presented through the cabin rig.
 *
 * Per XR frame (`onFrame`, the session's animation-frame callback):
 *
 * 1. the viewer pose → `cabinHeadStore` (clamped yaw/pitch) and
 *    `cabinHeadOffsetStore` (clamped lean) — the rig never moves;
 * 2. the left thumbstick → `XR_STICK` into the cabin input machine, which
 *    steers through STEER's path (`xrCabinInput` → `CarInputHandler`);
 * 3. each view → an eye target (sub-image view, viewport, frustum, world
 *    rotation) published for the renderer's tail (`renderer/xrPresentFrame`),
 *    and an eye camera request for the cabin (`cabinStereoRequest` 'views');
 * 4. the app's frame loops run (`frameClock.runXrFrame`): the road packs, the
 *    car loop renders the cabin and releases the tail, which draws both eyes
 *    into the layer; a tail still waiting is flushed, and a frame with no road
 *    frame re-presents the last one — the sub-images die when this returns.
 *
 * The right hand's `select` presses the dash control along its ray
 * (`car/runtime/interaction.pressCarInteriorAlongRay`, injected). Ending the
 * session — the user, the headset, or a lost device — puts every store back
 * and hands the frame loops back to the window. Audio is untouched.
 *
 * No WebGL path and no XR framework: WebXR + the WebXR/WebGPU binding only.
 */
import { povStore } from '../state/povStore';
import { cabinHeadStore } from '../state/cabinHeadStore';
import { cabinHeadOffsetStore } from '../state/cabinHeadOffsetStore';
import { getCabinStereoRequest, publishCabinStereoRequest, type CabinEyeView } from '../renderer/cabinStereoRequest';
import {
    getXrPresentedFrames,
    publishXrPresentFrame,
    representXrFrame,
    setXrPresenting,
    type XrEyeTarget,
} from '../renderer/xrPresentFrame';
import { frameTailScheduler } from '../renderer/reproject/frameTail';
import { beginXrFrames, endXrFrames, runXrFrame } from './frameClock';
import { emitXrCabinInput } from './xrCabinInput';
import {
    eyeFromHead,
    eyeSignOf,
    frustumFromProjection,
    halfIpdFromViews,
    headOffsetFromPosition,
    headPoseFromOrientation,
    worldFromEye,
    type XrVec3,
} from './xrPose';

type XrEndReason = 'user' | 'device-lost' | 'error';

export interface XrCockpitDeps {
    device: GPUDevice;
    /** Press the dash control along a car-frame ray (relative to the eye point). */
    pressAlongRay?: (origin: XrVec3, direction: XrVec3) => boolean;
    /** Injected for tests; default `navigator.xr` / the global `XRGPUBinding`. */
    xr?: Pick<XRSystem, 'requestSession'>;
    Binding?: typeof XRGPUBinding;
}

export interface XrCockpit {
    /** Leave the headset; resolves once everything is back in 2D. */
    end(): Promise<void>;
    /** Resolves when the session has ended, for whatever reason. */
    readonly ended: Promise<XrEndReason>;
}

/** The widest rectilinear Street View zoom (90° across): an eye's FOV needs all of it. */
const XR_ROAD_ZOOM = 1;
/** xr-standard gamepad: thumbstick X is axis 2 (touchpad X is 0). */
const THUMBSTICK_X = 2;

let active: XrCockpit | null = null;

export function getActiveXrCockpit(): XrCockpit | null {
    return active;
}

export class XrUnavailableError extends Error {}

/**
 * Enter the headset. Must be called from a user gesture (the dashboard
 * button). Rejects with an `XrUnavailableError` whose message says what is
 * missing when the session cannot use WebGPU.
 */
export async function startXrCockpit(deps: XrCockpitDeps): Promise<XrCockpit> {
    if (active) return active;
    const xr = deps.xr ?? (navigator as Navigator & { xr?: XRSystem }).xr;
    const Binding = deps.Binding ?? (globalThis as { XRGPUBinding?: typeof XRGPUBinding }).XRGPUBinding;
    if (!xr) throw new XrUnavailableError('This browser has no WebXR.');
    if (!Binding) throw new XrUnavailableError('Needs WebGPU-XR: this browser has WebXR but not the WebXR/WebGPU binding.');

    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['webgpu'] });
    const enabled = (session as XRSession & { enabledFeatures?: readonly string[] }).enabledFeatures;
    if (enabled && !enabled.includes('webgpu')) {
        await session.end().catch(() => undefined);
        throw new XrUnavailableError('Needs WebGPU-XR: the headset session was granted without WebGPU.');
    }

    let binding: XRGPUBinding;
    let layer: XRProjectionLayer;
    let format: GPUTextureFormat;
    let refSpace: XRReferenceSpace;
    try {
        binding = new Binding(session, deps.device);
        format = binding.getPreferredColorFormat();
        layer = binding.createProjectionLayer({ colorFormat: format, textureUsage: GPUTextureUsage.RENDER_ATTACHMENT });
        await session.updateRenderState({ layers: [layer] } as XRRenderStateInit);
        refSpace = await session.requestReferenceSpace('local');
    } catch (error) {
        await session.end().catch(() => undefined);
        throw error instanceof Error ? error : new Error(String(error));
    }

    let resolveEnded!: (reason: XrEndReason) => void;
    const ended = new Promise<XrEndReason>((resolve) => { resolveEnded = resolve; });
    let endReason: XrEndReason = 'user';
    let finished = false;

    const savedZoom = povStore.get().zoom;
    const savedStereo = getCabinStereoRequest();
    let origin: XrVec3 | null = null;
    let lastTime: number | null = null;

    const finish = () => {
        if (finished) return;
        finished = true;
        active = null;
        setXrPresenting(false);
        endXrFrames();
        publishCabinStereoRequest(savedStereo);
        cabinHeadStore.reset();
        cabinHeadOffsetStore.reset();
        povStore.setZoom(savedZoom);
        emitXrCabinInput({ type: 'XR_EXIT' });
        resolveEnded(endReason);
    };

    const onSelect = (event: XRInputSourceEvent) => {
        if (event.inputSource.handedness === 'left' || !origin || !deps.pressAlongRay) return;
        const pose = event.frame.getPose(event.inputSource.targetRaySpace, refSpace);
        if (!pose) return;
        const { position: p, orientation: q } = pose.transform;
        // The ray points down the space's −Z.
        const dir = rotate(q, { x: 0, y: 0, z: -1 });
        deps.pressAlongRay({ x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }, dir);
    };

    const onFrame = (time: number, frame: XRFrame) => {
        if (finished) return;
        session.requestAnimationFrame(onFrame);
        const dtS = lastTime === null ? 0 : (time - lastTime) / 1000;
        lastTime = time;
        const pose = frame.getViewerPose(refSpace);
        if (!pose) {
            // Tracking lost: keep the app's loops alive, show nothing new.
            runXrFrame(time);
            return;
        }
        origin ??= { ...pose.transform.position };
        const head = headPoseFromOrientation(pose.transform.orientation);
        const offset = headOffsetFromPosition(pose.transform.position, origin);
        cabinHeadStore.set(head);
        cabinHeadOffsetStore.set(offset);

        for (const source of session.inputSources) {
            const axisX = source.handedness === 'left' ? source.gamepad?.axes[THUMBSTICK_X] : undefined;
            if (axisX !== undefined) emitXrCabinInput({ type: 'XR_STICK', axisX, dtS });
        }

        const carHeading = povStore.get().carHeading;
        const cleared = new Map<GPUTexture, Set<number>>();
        const eyes: XrEyeTarget[] = [];
        const cabinViews: CabinEyeView[] = [];
        for (const view of pose.views) {
            const sub = binding.getViewSubImage(layer, view);
            const descriptor = sub.getViewDescriptor();
            const layerIndex = descriptor.baseArrayLayer ?? 0;
            const seen = cleared.get(sub.colorTexture) ?? new Set<number>();
            cleared.set(sub.colorTexture, seen);
            const vp = sub.viewport;
            eyes.push({
                view: sub.colorTexture.createView(descriptor),
                viewport: { x: vp.x, y: vp.y, width: vp.width, height: vp.height },
                frustum: frustumFromProjection(view.projectionMatrix),
                worldFromEye: worldFromEye(carHeading, view.transform.orientation),
                eyeSign: eyeSignOf(view.eye),
                clear: !seen.has(layerIndex),
            });
            seen.add(layerIndex);
            cabinViews.push({
                eyeFromHead: eyeFromHead(head, offset, view.transform, origin),
                projection: new Float32Array(view.projectionMatrix),
            });
        }
        if (cabinViews.length >= 2) {
            publishCabinStereoRequest({ kind: 'views', views: [cabinViews[0]!, cabinViews[1]!] });
        }
        publishXrPresentFrame({
            format,
            eyes,
            halfIpd: halfIpdFromViews(pose.views.map((v) => v.transform)),
        });

        const presented = getXrPresentedFrames();
        runXrFrame(time);
        frameTailScheduler.flush();
        if (getXrPresentedFrames() === presented) representXrFrame();
        publishXrPresentFrame(null);
    };

    session.addEventListener('select', onSelect);
    session.addEventListener('end', finish, { once: true });
    void deps.device.lost.then(() => {
        if (finished) return;
        endReason = 'device-lost';
        void session.end().catch(finish);
    });

    // In the order the frame needs them: the machine first (STEER, no lock),
    // then the clock, then presenting (every road frame splits from here on).
    emitXrCabinInput({ type: 'XR_ENTER' });
    povStore.setZoom(XR_ROAD_ZOOM);
    beginXrFrames();
    setXrPresenting(true);
    session.requestAnimationFrame(onFrame);

    const cockpit: XrCockpit = {
        ended,
        async end() {
            if (finished) return;
            try {
                await session.end();
            } catch {
                finish();
            }
            await ended;
        },
    };
    active = cockpit;
    return cockpit;
}

function rotate(q: DOMPointReadOnly | { x: number; y: number; z: number; w: number }, v: XrVec3): XrVec3 {
    // v + 2w(q × v) + 2 q × (q × v)
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
        x: v.x + q.w * tx + (q.y * tz - q.z * ty),
        y: v.y + q.w * ty + (q.z * tx - q.x * tz),
        z: v.z + q.w * tz + (q.x * ty - q.y * tx),
    };
}

export function resetXrCockpitForTests(): void {
    active = null;
}
