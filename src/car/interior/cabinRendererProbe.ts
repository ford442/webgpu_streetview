import type { CabinRendererBackend } from '../../utils/performance';
import type { WebGpuProbeRecord } from '../../renderer/webgpuBootProbe';

export interface CabinRendererProbe {
    backend: CabinRendererBackend;
    preference: CabinRendererBackend;
    ready: boolean;
    initFailed?: boolean;
    fallbackReason?: string;
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

export function readCabinRendererProbe(
    win: ProbeWindow | undefined = typeof window !== 'undefined' ? (window as ProbeWindow) : undefined,
): CabinRendererProbe | undefined {
    return win?.__CABIN_RENDERER_PROBE__ ?? win?.webgpuProbe?.cabin;
}
