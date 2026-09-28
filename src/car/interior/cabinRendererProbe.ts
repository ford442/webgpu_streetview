import type { CabinRendererBackend } from '../../utils/performance';
import type { WebGpuProbeRecord } from '../../renderer/webgpuBootProbe';

/**
 * State of the windshield portal (`WindshieldPortal.ts`) — the WebGPU cabin's
 * road-sampling wet-glass layer. Mirrored on `__CABIN_RENDERER_PROBE__.portal`.
 */
export interface CabinPortalProbe {
    /** The portal is the live windshield layer this frame (not the hole + decal fallback). */
    active: boolean;
    /** Why it is not active: the support gate, or no road frame yet. Undefined when active. */
    reason?: string;
    /** The shared device has `clip-distances`. */
    clipDistances: boolean;
    /** Format of the road HDR frame being sampled, while active. */
    frameFormat?: string;
    /**
     * True while the frame being sampled is the hold-pause snapshot — the portal
     * only ever reads the pass-1 intermediate, so a hop shows the held frame.
     */
    held?: boolean;
}

export interface CabinRendererProbe {
    backend: CabinRendererBackend;
    preference: CabinRendererBackend;
    ready: boolean;
    initFailed?: boolean;
    fallbackReason?: string;
    /**
     * True while the cabin draws into a `GPUTexture` the Street View renderer
     * composites into its own frame (`renderer/cabinComposite.ts`) instead of a
     * second canvas the page stacks in CSS. False on the WebGL hatch and on any
     * fallback, where cinema still needs the 2D latch.
     */
    composited?: boolean;
    /** Why the one-frame compositor is not in use, when it is not. */
    compositeReason?: string;
    /** The windshield portal — see `CabinPortalProbe`. */
    portal?: CabinPortalProbe;
    updatedAt: number;
}

type ProbeWindow = Window & {
    webgpuProbe?: WebGpuProbeRecord & { cabin?: CabinRendererProbe };
    __CABIN_RENDERER_PROBE__?: CabinRendererProbe;
};

/** Surface the cabin renderer choice on the backend chip / `webgpuProbe`. */
export function publishCabinRendererProbe(cabin: CabinRendererProbe): void {
    if (typeof window === 'undefined') return;
    const win = window as ProbeWindow;
    win.__CABIN_RENDERER_PROBE__ = cabin;
    if (win.webgpuProbe) {
        win.webgpuProbe = { ...win.webgpuProbe, cabin };
    }
}

/**
 * Update only the one-frame-compositor fields, leaving the backend/ready
 * fields the renderer construction published. No-op before car mode has
 * published a cabin probe at all.
 */
export function publishCabinCompositeState(
    composited: boolean,
    compositeReason?: string,
): void {
    if (typeof window === 'undefined') return;
    const win = window as ProbeWindow;
    const current = readCabinRendererProbe(win);
    if (!current) return;
    publishCabinRendererProbe({
        ...current,
        composited,
        compositeReason,
        updatedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    });
}

/**
 * Update only the windshield-portal field. Like `publishCabinCompositeState`,
 * a no-op before car mode has published a cabin probe at all.
 */
export function publishCabinPortalState(portal: CabinPortalProbe): void {
    if (typeof window === 'undefined') return;
    const win = window as ProbeWindow;
    const current = readCabinRendererProbe(win);
    if (!current) return;
    publishCabinRendererProbe({
        ...current,
        portal,
        updatedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    });
}

export function readCabinRendererProbe(
    win: ProbeWindow | undefined = typeof window !== 'undefined' ? (window as ProbeWindow) : undefined,
): CabinRendererProbe | undefined {
    return win?.__CABIN_RENDERER_PROBE__ ?? win?.webgpuProbe?.cabin;
}
