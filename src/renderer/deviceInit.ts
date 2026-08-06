import {
    getAdapterPowerPreferencePolicy,
    getAdapterRequestOptions as getRequestedAdapterOptions,
    RendererInitOptions,
    WeatherPostProcessMode,
} from './RendererBackend';

/**
 * Resolve WebGPU adapter request options: URL override, battery heuristic, or high-performance default.
 */
export async function resolveAdapterRequestOptions(
    options?: RendererInitOptions,
): Promise<GPURequestAdapterOptions> {
    const policy = getAdapterPowerPreferencePolicy(options);
    if (policy.source !== 'default') {
        return getRequestedAdapterOptions(options);
    }

    const batteryApi = (navigator as Navigator & {
        getBattery?: () => Promise<{ charging: boolean; level: number }>;
    }).getBattery;
    if (typeof batteryApi !== 'function') {
        return { powerPreference: 'high-performance' };
    }

    try {
        const battery = await batteryApi.call(navigator);
        if (!battery.charging && battery.level <= 0.2) {
            return { powerPreference: 'low-power' };
        }
    } catch {
        // Ignore battery API failures and fall back to high-performance.
    }

    return { powerPreference: 'high-performance' };
}

export function checkRequiredLimits(
    adapter: GPUAdapter,
    weatherPostProcessMode: WeatherPostProcessMode,
): {
    ok: boolean;
    reason?: string;
    requiredLimits?: Record<string, number>;
} {
    const limits = adapter.limits;
    const required: Partial<Record<keyof GPUSupportedLimits, number>> = {
        maxTextureDimension2D: 4096,
    };
    if (weatherPostProcessMode === 'compute') {
        required.maxStorageBufferBindingSize = 65536;
        required.maxBufferSize = 65536;
    }

    for (const [name, minimum] of Object.entries(required) as Array<[keyof GPUSupportedLimits, number]>) {
        const supported = Number(limits[name]);
        if (!Number.isFinite(supported) || supported < minimum) {
            return {
                ok: false,
                reason: `Adapter limit ${String(name)}=${supported} below required ${minimum}`,
            };
        }
    }

    return {
        ok: true,
        requiredLimits: required as Record<string, number>,
    };
}

export function collectOptionalDeviceFeatures(adapter: GPUAdapter): GPUFeatureName[] {
    const requiredFeatures: GPUFeatureName[] = [];
    if (adapter.features.has('float32-filterable')) {
        requiredFeatures.push('float32-filterable');
    }
    return requiredFeatures;
}

export function logAdapterCapabilities(
    adapter: GPUAdapter,
    powerPreference?: GPUPowerPreference,
    weatherPostProcessMode?: WeatherPostProcessMode,
): void {
    const adapterInfo = (adapter as GPUAdapter & {
        info?: { vendor?: string; architecture?: string; device?: string; description?: string };
    }).info;
    const summary = {
        powerPreference: powerPreference || 'unspecified',
        weatherMode: weatherPostProcessMode,
        vendor: adapterInfo?.vendor || 'unknown',
        architecture: adapterInfo?.architecture || 'unknown',
        device: adapterInfo?.device || 'unknown',
        description: adapterInfo?.description || 'unknown',
        limits: {
            maxTextureDimension2D: Number(adapter.limits.maxTextureDimension2D),
            maxStorageBufferBindingSize: Number(adapter.limits.maxStorageBufferBindingSize),
            maxBufferSize: Number(adapter.limits.maxBufferSize),
        },
    };

    console.info('[Renderer] WebGPU adapter capabilities:', summary);
    if (typeof window !== 'undefined') {
        (window as Window & { rendererAdapterInfo?: typeof summary }).rendererAdapterInfo = summary;
    }
}

/** Configure swap-chain with opaque sRGB output and copy-src for snapshots. */
export function configureCanvasContext(
    context: GPUCanvasContext,
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
): void {
    context.configure({
        device,
        format: presentationFormat,
        alphaMode: 'opaque',
        colorSpace: 'srgb',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
}
