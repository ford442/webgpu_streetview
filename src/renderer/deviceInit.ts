import {
    getAdapterPowerPreferencePolicy,
    getAdapterRequestOptions as getRequestedAdapterOptions,
    RendererInitOptions,
    WeatherPostProcessMode,
} from './RendererBackend';
import {
    COMPUTE_WEATHER_WORKGROUP_SIZE,
    OPTIONAL_DEVICE_FEATURES,
    type AdapterCapabilitySummary,
    type DeviceCapabilityMatrix,
} from './deviceCapabilities';

export interface CollectOptionalFeaturesOptions {
    /** Request timestamp-query when the adapter supports it (performance overlay). */
    enableTimestampQueries?: boolean;
}

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
        required.maxComputeWorkgroupSizeX = COMPUTE_WEATHER_WORKGROUP_SIZE;
        required.maxComputeWorkgroupSizeY = COMPUTE_WEATHER_WORKGROUP_SIZE;
        required.maxComputeInvocationsPerWorkgroup =
            COMPUTE_WEATHER_WORKGROUP_SIZE * COMPUTE_WEATHER_WORKGROUP_SIZE;
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

export function collectOptionalDeviceFeatures(
    adapter: GPUAdapter,
    options: CollectOptionalFeaturesOptions = {},
): GPUFeatureName[] {
    const features: GPUFeatureName[] = [];
    if (adapter.features.has(OPTIONAL_DEVICE_FEATURES.float32Filterable)) {
        features.push(OPTIONAL_DEVICE_FEATURES.float32Filterable);
    }
    if (options.enableTimestampQueries !== false
        && adapter.features.has(OPTIONAL_DEVICE_FEATURES.timestampQuery)) {
        features.push(OPTIONAL_DEVICE_FEATURES.timestampQuery);
    }
    return features;
}

export function buildCapabilityMatrix(
    weatherPostProcessMode: WeatherPostProcessMode,
    requiredLimits: Record<string, number>,
    enabledFeatures: GPUFeatureName[],
): DeviceCapabilityMatrix {
    return {
        weatherPostProcessMode,
        requiredLimits,
        optionalFeaturesAttempted: [
            OPTIONAL_DEVICE_FEATURES.float32Filterable,
            OPTIONAL_DEVICE_FEATURES.timestampQuery,
        ],
        optionalFeaturesEnabled: enabledFeatures,
        timestampQueriesAvailable: enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.timestampQuery),
        temporalDepthPingPong: weatherPostProcessMode === 'compute',
    };
}

export function logAdapterCapabilities(
    adapter: GPUAdapter,
    powerPreference?: GPUPowerPreference,
    weatherPostProcessMode?: WeatherPostProcessMode,
    enabledFeatures: GPUFeatureName[] = [],
    capabilityMatrix?: DeviceCapabilityMatrix,
): void {
    const adapterInfo = (adapter as GPUAdapter & {
        info?: { vendor?: string; architecture?: string; device?: string; description?: string };
    }).info;
    const summary: AdapterCapabilitySummary = {
        powerPreference: powerPreference || undefined,
        weatherMode: weatherPostProcessMode,
        vendor: adapterInfo?.vendor || 'unknown',
        architecture: adapterInfo?.architecture || 'unknown',
        device: adapterInfo?.device || 'unknown',
        description: adapterInfo?.description || 'unknown',
        limits: {
            maxTextureDimension2D: Number(adapter.limits.maxTextureDimension2D),
            maxStorageBufferBindingSize: Number(adapter.limits.maxStorageBufferBindingSize),
            maxBufferSize: Number(adapter.limits.maxBufferSize),
            maxComputeWorkgroupSizeX: Number(adapter.limits.maxComputeWorkgroupSizeX),
            maxComputeWorkgroupSizeY: Number(adapter.limits.maxComputeWorkgroupSizeY),
            maxComputeInvocationsPerWorkgroup: Number(adapter.limits.maxComputeInvocationsPerWorkgroup),
        },
        enabledFeatures,
        capabilityMatrix,
    };

    console.info('[Renderer] WebGPU adapter capabilities:', summary);
    if (typeof window !== 'undefined') {
        (window as Window & { rendererAdapterInfo?: AdapterCapabilitySummary }).rendererAdapterInfo = summary;
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
