/**
 * The depth Worker's adapter policy (#367 slice 3), pure so both sides of the
 * Worker boundary — and the tests — share it.
 *
 * The Worker used to hard-code `powerPreference: 'high-performance'`: it
 * ignored the battery heuristic, `?gpu=low-power` and `?gpu=compat`, and on a
 * dual-GPU laptop it could wake the discrete GPU while the road ran on the
 * integrated one. Now the main thread hands it the options the road's adapter
 * was actually requested with (`runtime/contexts.ts` → `gpu.requestOptions`)
 * and the road adapter's identity; the Worker requests with the same options
 * and, on a different physical adapter, retries once with the opposite power
 * preference before accepting what it has (`adapterMismatch`).
 *
 * The Worker's device is still the one `requestDevice` outside `bootDevice.ts`.
 */
import type { GpuAdapterIdentity, GpuContext } from '../../runtime/contexts';

/** What the Worker may pass to `requestAdapter` — never `xrCompatible` (it renders nothing). */
export interface DepthAdapterRequest {
    powerPreference?: GPUPowerPreference;
    featureLevel?: 'core' | 'compatibility';
    forceFallbackAdapter?: boolean;
}

/** Before the road has booted (it always has by the time depth loads): the historical request. */
const NO_ROAD_REQUEST: DepthAdapterRequest = { powerPreference: 'high-performance' };

/** The road's request options, minus what a compute-only Worker device must not ask for. */
export function buildDepthAdapterRequest(gpu: Pick<GpuContext, 'requestOptions'> | null | undefined): DepthAdapterRequest {
    if (!gpu) return { ...NO_ROAD_REQUEST };
    const options = gpu.requestOptions as GPURequestAdapterOptions & { featureLevel?: 'core' | 'compatibility' };
    const request: DepthAdapterRequest = {};
    if (options.powerPreference) request.powerPreference = options.powerPreference;
    if (options.featureLevel) request.featureLevel = options.featureLevel;
    if (options.forceFallbackAdapter) request.forceFallbackAdapter = true;
    return request;
}

export function oppositePowerPreference(preference: GPUPowerPreference): GPUPowerPreference {
    return preference === 'low-power' ? 'high-performance' : 'low-power';
}

/** `GPUAdapter.info` as a plain identity (empty strings where the browser withholds a field). */
export function adapterIdentity(adapter: Pick<GPUAdapter, 'info'> | null | undefined): GpuAdapterIdentity {
    const info = adapter?.info;
    return {
        vendor: info?.vendor ?? '',
        architecture: info?.architecture ?? '',
        device: info?.device ?? '',
        description: info?.description ?? '',
    };
}

/**
 * Same physical adapter? Compares vendor / architecture / device where both
 * sides report them. Null when that cannot be told (either side reports
 * nothing comparable — browsers may withhold every field).
 */
export function sameAdapter(a: GpuAdapterIdentity | null | undefined, b: GpuAdapterIdentity | null | undefined): boolean | null {
    if (!a || !b) return null;
    let compared = 0;
    for (const key of ['vendor', 'architecture', 'device'] as const) {
        if (!a[key] || !b[key]) continue;
        compared += 1;
        if (a[key] !== b[key]) return false;
    }
    return compared > 0 ? true : null;
}

/** Human-readable adapter label for the stats / overlay. */
export function describeAdapter(identity: GpuAdapterIdentity): string {
    return [identity.vendor, identity.architecture, identity.description].filter(Boolean).join(' ') || 'unknown';
}
