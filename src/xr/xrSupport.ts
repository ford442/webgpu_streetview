/**
 * Can this browser put the cockpit in a headset (#331)?
 *
 * Three independent gates, reported in order so the dashboard button can say
 * honestly which one is missing:
 *
 * 1. `navigator.xr` — no WebXR at all: the button is hidden.
 * 2. `XRGPUBinding` — WebXR without the WebGPU binding (Chrome without
 *    `chrome://flags/#webxr-webgpu-binding`, Firefox, …): "needs WebGPU-XR".
 *    The app has one `GPUDevice`; a WebGL XR path would need a second device
 *    and a second canvas, which is out of scope by design.
 * 3. `isSessionSupported('immersive-vr')` — the binding exists but no headset
 *    runtime answers.
 *
 * `?xr=off` is the kill switch. The result also decides whether boot asks for
 * an `xrCompatible` adapter (`deviceInit.resolveAdapterRequestOptions`) — the
 * one device has to be XR-compatible from the start, it cannot be made so later.
 */
import { readFlag } from '../config/flags';

export type XrSupportState =
    | 'off'
    | 'no-webxr'
    | 'no-webgpu-binding'
    | 'no-immersive-vr'
    | 'available';

export interface XrSupport {
    state: XrSupportState;
    /** For the button / probe — what is missing, in words. */
    reason: string;
}

const REASONS: Record<XrSupportState, string> = {
    off: 'WebXR is switched off (?xr=off).',
    'no-webxr': 'This browser has no WebXR.',
    'no-webgpu-binding': 'Needs WebGPU-XR: this browser has WebXR but not the WebXR/WebGPU binding (Chrome: chrome://flags/#webxr-webgpu-binding).',
    'no-immersive-vr': 'No VR headset is available to this browser.',
    available: 'A WebGPU-XR headset session is available.',
};

export function xrSupport(state: XrSupportState): XrSupport {
    return { state, reason: REASONS[state] };
}

export interface XrSupportEnv {
    xr?: Pick<XRSystem, 'isSessionSupported'> | undefined;
    hasBinding: boolean;
    off: boolean;
    /** isSessionSupported can hang on some runtimes; boot must not. */
    timeoutMs?: number;
}

function defaultEnv(): XrSupportEnv {
    const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { xr?: XRSystem } : undefined;
    return {
        xr: nav?.xr,
        hasBinding: typeof globalThis !== 'undefined' && 'XRGPUBinding' in globalThis,
        off: readFlag('xr') === false,
    };
}

let last: XrSupport | null = null;

export async function detectXrSupport(env: XrSupportEnv = defaultEnv()): Promise<XrSupport> {
    const result = await detect(env);
    last = result;
    return result;
}

async function detect(env: XrSupportEnv): Promise<XrSupport> {
    if (env.off) return xrSupport('off');
    if (!env.xr) return xrSupport('no-webxr');
    if (!env.hasBinding) return xrSupport('no-webgpu-binding');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const supported = await Promise.race([
            env.xr.isSessionSupported('immersive-vr'),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), env.timeoutMs ?? 750);
            }),
        ]);
        return xrSupport(supported ? 'available' : 'no-immersive-vr');
    } catch {
        return xrSupport('no-immersive-vr');
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** What the last detection found (boot runs it), or null before boot. */
export function getLastXrSupport(): XrSupport | null {
    return last;
}

export function resetXrSupportForTests(): void {
    last = null;
}
