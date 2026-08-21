import {
    buildAdapterRequestOptions,
    getAdapterPowerPreferencePolicy,
    getAdapterSelectionPolicy,
    getCanvasOutputFlags,
    supportsAdapterFeatureLevel,
    type AdapterFeatureLevel,
    type AdapterSelectionPolicy,
    type CanvasOutputFlags,
    RendererInitOptions,
    WeatherPostProcessMode,
} from './RendererBackend';
import {
    COMPUTE_WEATHER_WORKGROUP_SIZE,
    COMPUTE_CHORES_WORKGROUP_SIZE,
    DEVICE_LABELS,
    OPTIONAL_DEVICE_FEATURES,
    type AdapterCapabilitySummary,
    type DeviceCapabilityMatrix,
} from './deviceCapabilities';
import { readNoGpuComputeFlag } from './gpuChores/gpuChoresPolicy';

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
    const selection = getAdapterSelectionPolicy();
    const featureLevelSupported = supportsAdapterFeatureLevel();
    const policy = getAdapterPowerPreferencePolicy(options);
    if (policy.source !== 'default') {
        return buildAdapterRequestOptions(policy.powerPreference, selection, featureLevelSupported);
    }

    return buildAdapterRequestOptions(
        await resolveDefaultPowerPreference(),
        selection,
        featureLevelSupported,
    );
}

/** Battery heuristic for the default (no `?gpu=`, no override) power preference. */
async function resolveDefaultPowerPreference(): Promise<GPUPowerPreference> {
    const batteryApi = (navigator as Navigator & {
        getBattery?: () => Promise<{ charging: boolean; level: number }>;
    }).getBattery;
    if (typeof batteryApi !== 'function') {
        return 'high-performance';
    }

    try {
        const battery = await batteryApi.call(navigator);
        if (!battery.charging && battery.level <= 0.2) {
            return 'low-power';
        }
    } catch {
        // Ignore battery API failures and fall back to high-performance.
    }

    return 'high-performance';
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

export interface CapabilityMatrixContext {
    /** Omitted (=> `'unknown'`) when the browser has no `featureLevel` field. */
    featureLevel?: AdapterFeatureLevel | 'unknown';
    forceFallbackAdapter?: boolean;
    canvas?: AppliedCanvasConfiguration;
}

export function buildCapabilityMatrix(
    weatherPostProcessMode: WeatherPostProcessMode,
    requiredLimits: Record<string, number>,
    enabledFeatures: GPUFeatureName[],
    context: CapabilityMatrixContext = {},
): DeviceCapabilityMatrix {
    const canvas = context.canvas;
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
        featureLevel: context.featureLevel ?? 'unknown',
        forceFallbackAdapter: context.forceFallbackAdapter ?? false,
        canvasFormat: canvas?.format ?? 'bgra8unorm',
        canvasColorSpace: canvas?.colorSpace ?? 'srgb',
        canvasToneMapping: canvas?.toneMapping ?? 'standard',
        viewFormats: canvas?.viewFormats ?? [],
        canvasDowngradeReason: canvas?.downgradeReason,
        uncapturedErrorCount: 0,
        gpuChoresWorkgroupSize: COMPUTE_CHORES_WORKGROUP_SIZE,
        gpuChoresKillSwitch: readNoGpuComputeFlag(),
    };
}

/** Derive the capability-matrix adapter fields from the options we actually sent. */
export function describeAdapterSelection(
    requestOptions: GPURequestAdapterOptions,
): Pick<CapabilityMatrixContext, 'featureLevel' | 'forceFallbackAdapter'> {
    const featureLevel = (requestOptions as { featureLevel?: AdapterFeatureLevel }).featureLevel;
    return {
        featureLevel: featureLevel ?? 'unknown',
        forceFallbackAdapter: requestOptions.forceFallbackAdapter === true,
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

/** HDR swap-chain format used when extended tone mapping is accepted. */
export const HDR_CANVAS_FORMAT: GPUTextureFormat = 'rgba16float';

/**
 * Swap-chain usage — `COPY_SRC` is required by cinema clip capture and snapshots
 * and must never be dropped. Literals mirror the spec values so the pure builder
 * stays usable in environments without a `GPUTextureUsage` global (tests, SSR).
 */
export const CANVAS_USAGE = typeof GPUTextureUsage !== 'undefined'
    ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    : 0x10 | 0x01;

export interface CanvasOutputPolicyInput {
    /** `navigator.gpu.getPreferredCanvasFormat()`. */
    preferredFormat: GPUTextureFormat;
    /** Features actually enabled on the device (HDR needs `float32-filterable`). */
    enabledFeatures?: GPUFeatureName[];
    flags?: CanvasOutputFlags;
    /** `matchMedia('(dynamic-range: high)')` — only consulted for `?hdr=auto`. */
    displaySupportsHdr?: boolean;
    /** `matchMedia('(color-gamut: p3)')` — only consulted for `?p3=auto`. */
    displaySupportsP3?: boolean;
}

export interface CanvasOutputPolicy {
    hdr: boolean;
    p3: boolean;
    /** Why an explicitly requested opt-in was not honored (soft-log, stay SDR). */
    hdrRejectedReason?: string;
}

/**
 * Resolve the output-referred canvas policy. Both opt-ins default off, so a
 * default boot is byte-identical to the historical SDR sRGB opaque swap-chain.
 */
export function resolveCanvasOutputPolicy(input: CanvasOutputPolicyInput): CanvasOutputPolicy {
    const flags = input.flags ?? { hdr: 'off', p3: 'off' };
    const enabledFeatures = input.enabledFeatures ?? [];

    const hdrWanted = flags.hdr === 'on' || (flags.hdr === 'auto' && input.displaySupportsHdr === true);
    const hdrCapable = enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.float32Filterable);
    const p3 = flags.p3 === 'on' || (flags.p3 === 'auto' && input.displaySupportsP3 === true);

    if (hdrWanted && !hdrCapable) {
        return {
            hdr: false,
            p3,
            hdrRejectedReason: `HDR requested but ${OPTIONAL_DEVICE_FEATURES.float32Filterable} is not enabled`,
        };
    }

    return { hdr: hdrWanted && hdrCapable, p3 };
}

/** Read the display-side `auto` gates; safe in jsdom / SSR where matchMedia is absent. */
export function readDisplayOutputCapabilities(): { displaySupportsHdr: boolean; displaySupportsP3: boolean } {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return { displaySupportsHdr: false, displaySupportsP3: false };
    }
    const match = (query: string): boolean => {
        try {
            return window.matchMedia(query).matches === true;
        } catch {
            return false;
        }
    };
    return {
        displaySupportsHdr: match('(dynamic-range: high)'),
        displaySupportsP3: match('(color-gamut: p3)'),
    };
}

export interface CanvasConfigurationDescriptor extends GPUCanvasConfiguration {
    colorSpace: 'srgb' | 'display-p3';
    /** Chrome 123+; ignored as an unknown dictionary member on older browsers. */
    toneMapping?: { mode: 'standard' | 'extended' };
    label?: string;
}

/**
 * Pure builder for `context.configure()`. With an all-off policy this emits
 * exactly the four historical fields (format, alphaMode, colorSpace, usage).
 */
export function buildCanvasConfiguration(
    device: GPUDevice,
    preferredFormat: GPUTextureFormat,
    policy: CanvasOutputPolicy = { hdr: false, p3: false },
): CanvasConfigurationDescriptor {
    const descriptor: CanvasConfigurationDescriptor = {
        device,
        format: policy.hdr ? HDR_CANVAS_FORMAT : preferredFormat,
        alphaMode: 'opaque',
        colorSpace: policy.p3 ? 'display-p3' : 'srgb',
        usage: CANVAS_USAGE,
        label: DEVICE_LABELS.swapChain,
    };
    if (policy.hdr) {
        descriptor.viewFormats = [];
        descriptor.toneMapping = { mode: 'extended' };
    }
    return descriptor;
}

export interface AppliedCanvasConfiguration {
    format: GPUTextureFormat;
    colorSpace: 'srgb' | 'display-p3';
    toneMapping: 'standard' | 'extended';
    viewFormats: GPUTextureFormat[];
    downgradeReason?: string;
}

/**
 * Configure the swap-chain, falling back to the SDR sRGB opaque configuration if
 * the browser rejects the requested HDR / display-P3 descriptor. Returns what was
 * actually applied — callers must use the returned `format` as their presentation
 * format, since the HDR path swaps it to `rgba16float`.
 */
export function configureCanvasContext(
    context: GPUCanvasContext,
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
    policy: CanvasOutputPolicy = { hdr: false, p3: false },
): AppliedCanvasConfiguration {
    const descriptor = buildCanvasConfiguration(device, presentationFormat, policy);
    try {
        context.configure(descriptor);
        return {
            format: descriptor.format,
            colorSpace: descriptor.colorSpace,
            toneMapping: descriptor.toneMapping?.mode ?? 'standard',
            viewFormats: [...(descriptor.viewFormats ?? [])],
            downgradeReason: policy.hdrRejectedReason,
        };
    } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[Renderer] Canvas configure rejected — falling back to SDR sRGB:', reason);
        const sdr = buildCanvasConfiguration(device, presentationFormat, { hdr: false, p3: false });
        context.configure(sdr);
        return {
            format: sdr.format,
            colorSpace: 'srgb',
            toneMapping: 'standard',
            viewFormats: [],
            downgradeReason: reason,
        };
    }
}

/**
 * Count uncaptured validation/OOM errors and surface the latest on the capability
 * matrix (and therefore `window.rendererAdapterInfo` / the backend chip). Kept
 * separate from the `device.lost` promise so we never double-dispose.
 */
export function attachUncapturedErrorHandler(
    device: GPUDevice,
    capabilityMatrix: DeviceCapabilityMatrix,
): void {
    if (typeof device.addEventListener !== 'function') return;
    device.addEventListener('uncapturederror', (event: Event) => {
        const error = (event as GPUUncapturedErrorEvent).error;
        const message = error instanceof Error ? error.message : String(error);
        capabilityMatrix.uncapturedErrorCount += 1;
        capabilityMatrix.lastUncapturedError = message;
        console.error('[Renderer] uncapturederror', error);
        if (typeof window !== 'undefined') {
            const info = (window as Window & { rendererAdapterInfo?: AdapterCapabilitySummary }).rendererAdapterInfo;
            if (info?.capabilityMatrix) {
                info.capabilityMatrix.uncapturedErrorCount = capabilityMatrix.uncapturedErrorCount;
                info.capabilityMatrix.lastUncapturedError = message;
            }
        }
    });
}

/** Apply readable labels to the device and its default queue. */
export function labelDevice(device: GPUDevice): void {
    try {
        device.label = DEVICE_LABELS.device;
        if (device.queue) device.queue.label = DEVICE_LABELS.queue;
    } catch {
        // Labels are diagnostics only — never block init on them.
    }
}

export { getCanvasOutputFlags };
export type { AdapterSelectionPolicy, CanvasOutputFlags };
