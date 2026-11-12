import type { CabinPortalProbe, CabinRendererProbe } from '../../debug/probeTypes';

type ProbeWindow = Pick<Window, 'webgpuProbe' | '__CABIN_RENDERER_PROBE__'>;

/** Surface the cabin renderer choice on the backend chip / `webgpuProbe`. */
export function publishCabinRendererProbe(cabin: CabinRendererProbe): void {
    if (typeof window === 'undefined') return;
    const win = window;
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
    const win = window;
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
    const win = window;
    const current = readCabinRendererProbe(win);
    if (!current) return;
    publishCabinRendererProbe({
        ...current,
        portal,
        updatedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    });
}

export function readCabinRendererProbe(
    win: ProbeWindow | undefined = typeof window !== 'undefined' ? window : undefined,
): CabinRendererProbe | undefined {
    return win?.__CABIN_RENDERER_PROBE__ ?? win?.webgpuProbe?.cabin;
}

declare global {
    interface Window {
        __CABIN_RENDERER_PROBE__?: CabinRendererProbe;
    }
}
