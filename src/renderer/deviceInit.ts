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
    OPTIONAL_FEATURES_ATTEMPTED,
    type AdapterCapabilitySummary,
    type DeviceCapabilityMatrix,
} from './deviceCapabilities';
import { readNoGpuComputeFlag } from './gpuChores/gpuChoresPolicy';
import {
    resolveHdrIntermediateFormat,
    resolveShaderFeatureUses,
} from './shaderFeatureVariants';

export interface CollectOptionalFeaturesOptions {
    /** Request timestamp-query when the adapter supports it (performance overlay). */
    enableTimestampQueries?: boolean;
    /**
     * Request `clip-distances` when the adapter supports it. Defaults on; the
     * `?no_clip_distances` kill switch turns it off so the cabin's windshield
     * portal can be exercised on its hole + overlay fallback without needing an
     * adapter that lacks the feature.
     */
    enableClipDistances?: boolean;
    /**
     * Skip `core-features-and-limits` when the adapter was requested in
     * compatibility mode (`?gpu=compat`) so we do not undo that knob.
     */
    featureLevel?: AdapterFeatureLevel | 'unknown';
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

export interface GpuChoresLimitCheck {
    /** Adapter can run the `@workgroup_size(8,8,1)` chores pipelines. */
    eligible: boolean;
    reason?: string;
}

const GPU_CHORES_LIMITS: ReadonlyArray<readonly [keyof GPUSupportedLimits, number]> = [
    ['maxComputeWorkgroupSizeX', COMPUTE_CHORES_WORKGROUP_SIZE],
    ['maxComputeWorkgroupSizeY', COMPUTE_CHORES_WORKGROUP_SIZE],
    ['maxComputeInvocationsPerWorkgroup', COMPUTE_CHORES_WORKGROUP_SIZE * COMPUTE_CHORES_WORKGROUP_SIZE],
];

/**
 * Can this adapter run #216 gpu-chores on the shared device? Never a boot
 * failure — an ineligible adapter keeps chores on the WASM/JS twin.
 */
export function checkGpuChoresLimits(limits: GPUSupportedLimits): GpuChoresLimitCheck {
    for (const [name, minimum] of GPU_CHORES_LIMITS) {
        const supported = Number(limits[name]);
        if (!Number.isFinite(supported) || supported < minimum) {
            return {
                eligible: false,
                reason: `Adapter limit ${String(name)}=${supported} below gpu-chores ${minimum}`,
            };
        }
    }
    return { eligible: true };
}

/** Below this the panorama + HDR intermediate cannot fit a desktop window: boot fails. */
export const MIN_TEXTURE_DIMENSION_2D = 4096;
/** The largest 2D texture any pass allocates (DPR-scaled canvas, Maps canvas upload). */
export const MAX_REQUESTED_TEXTURE_DIMENSION_2D = 8192;

/**
 * Fit `width × height` inside `maxDimension` on both axes, keeping the aspect
 * ratio. Unchanged when it already fits. Never returns a zero dimension.
 */
export function clampTextureSize(
    width: number,
    height: number,
    maxDimension: number,
): { width: number; height: number; clamped: boolean } {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const max = Math.max(1, Math.floor(maxDimension));
    if (w <= max && h <= max) return { width: w, height: h, clamped: false };
    const scale = max / Math.max(w, h);
    return {
        width: Math.max(1, Math.min(max, Math.floor(w * scale))),
        height: Math.max(1, Math.min(max, Math.floor(h * scale))),
        clamped: true,
    };
}

export function checkRequiredLimits(
    adapter: GPUAdapter,
    weatherPostProcessMode: WeatherPostProcessMode,
): {
    ok: boolean;
    reason?: string;
    requiredLimits?: Record<string, number>;
    /** Reported on every boot (pass or fail); chores never gate the weather boot. */
    gpuChores: GpuChoresLimitCheck;
} {
    const limits = adapter.limits;
    const gpuChores = checkGpuChoresLimits(limits);
    const required: Partial<Record<keyof GPUSupportedLimits, number>> = {
        maxTextureDimension2D: MIN_TEXTURE_DIMENSION_2D,
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
                gpuChores,
            };
        }
    }

    // The gate above is the floor; the request is what the adapter can give,
    // up to what the passes use. The default device limit is the *core*
    // default (8192), not the adapter's — and under `?gpu=compat` it is 4096,
    // which a 2560-CSS-px window at DPR 2 overruns. Textures are still clamped
    // to `device.limits` at allocation (see `clampTextureSize`).
    required.maxTextureDimension2D = Math.max(
        MIN_TEXTURE_DIMENSION_2D,
        Math.min(Number(limits.maxTextureDimension2D), MAX_REQUESTED_TEXTURE_DIMENSION_2D),
    );

    // Chores share this device: when the adapter can run them, put their 8×8
    // limits in the contract (compute weather's 16×16 already covers them).
    // Only added when supported, so they can never fail requestDevice.
    if (gpuChores.eligible) {
        for (const [name, minimum] of GPU_CHORES_LIMITS) {
            required[name] = Math.max(required[name] ?? 0, minimum);
        }
    }

    return {
        ok: true,
        requiredLimits: required as Record<string, number>,
        gpuChores,
    };
}

/**
 * `?no_clip_distances` — do not request `clip-distances` on the shared device.
 * Same grammar as `?no_gpu_compute`: present (or truthy) is on, `0|false|off` is off.
 */
export function readNoClipDistancesFlag(
    search: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
    try {
        const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
        const raw = params.get('no_clip_distances');
        if (raw === null) return false;
        const v = raw.toLowerCase();
        return !(v === '0' || v === 'false' || v === 'off');
    } catch {
        return false;
    }
}

export function collectOptionalDeviceFeatures(
    adapter: GPUAdapter,
    options: CollectOptionalFeaturesOptions = {},
): GPUFeatureName[] {
    const features: GPUFeatureName[] = [];
    const tryAdd = (name: GPUFeatureName, extraGate = true): void => {
        if (!extraGate) return;
        if (adapter.features.has(name)) features.push(name);
    };

    tryAdd(OPTIONAL_DEVICE_FEATURES.float32Filterable);

    const timestamps = options.enableTimestampQueries !== false;
    tryAdd(OPTIONAL_DEVICE_FEATURES.timestampQuery, timestamps);
    // Not requested: `timestamp-query-inside-passes` is not a feature name any
    // browser ships (Chromium's is `chromium-experimental-…`), and `shader-f16`
    // has no production WGSL consumer — see OPTIONAL_DEVICE_FEATURES.shaderF16.

    tryAdd(OPTIONAL_DEVICE_FEATURES.subgroups);
    tryAdd(OPTIONAL_DEVICE_FEATURES.rg11b10ufloatRenderable);
    tryAdd(OPTIONAL_DEVICE_FEATURES.dualSourceBlending);
    tryAdd(OPTIONAL_DEVICE_FEATURES.clipDistances, options.enableClipDistances !== false);
    tryAdd(
        OPTIONAL_DEVICE_FEATURES.coreFeaturesAndLimits,
        options.featureLevel !== 'compatibility',
    );

    return features;
}

export interface CapabilityMatrixContext {
    /** Omitted (=> `'unknown'`) when the browser has no `featureLevel` field. */
    featureLevel?: AdapterFeatureLevel | 'unknown';
    forceFallbackAdapter?: boolean;
    canvas?: AppliedCanvasConfiguration;
    /** Pass-1 HDR intermediate; defaults to rgba16float when omitted. */
    intermediateFormat?: GPUTextureFormat;
    /** `checkRequiredLimits(...).gpuChores`; omitted => eligible (pipeline-create catch still guards). */
    gpuChores?: GpuChoresLimitCheck;
}

export function buildCapabilityMatrix(
    weatherPostProcessMode: WeatherPostProcessMode,
    requiredLimits: Record<string, number>,
    enabledFeatures: GPUFeatureName[],
    context: CapabilityMatrixContext = {},
): DeviceCapabilityMatrix {
    const canvas = context.canvas;
    const intermediateFormat = context.intermediateFormat
        ?? resolveHdrIntermediateFormat(enabledFeatures);
    return {
        weatherPostProcessMode,
        requiredLimits,
        optionalFeaturesAttempted: [...OPTIONAL_FEATURES_ATTEMPTED],
        optionalFeaturesEnabled: enabledFeatures,
        timestampQueriesAvailable: enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.timestampQuery),
        // The spec path on every browser shipping timestamp-query today; the
        // legacy inside-passes fallback only replaces this if GpuPassTimer's
        // descriptor probe is rejected.
        timestampWriteStrategy: enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.timestampQuery)
            ? 'pass-descriptor'
            : 'none',
        temporalDepthPingPong: weatherPostProcessMode === 'compute',
        featureLevel: context.featureLevel ?? 'unknown',
        forceFallbackAdapter: context.forceFallbackAdapter ?? false,
        canvasFormat: canvas?.format ?? 'bgra8unorm',
        canvasColorSpace: canvas?.colorSpace ?? 'srgb',
        canvasToneMapping: canvas?.toneMapping ?? 'standard',
        viewFormats: canvas?.viewFormats ?? [],
        intermediateFormat,
        shaderFeatureUses: resolveShaderFeatureUses(
            enabledFeatures,
            intermediateFormat,
            canvas?.toneMapping ?? 'standard',
        ),
        canvasDowngradeReason: canvas?.downgradeReason,
        uncapturedErrorCount: 0,
        gpuChoresWorkgroupSize: COMPUTE_CHORES_WORKGROUP_SIZE,
        gpuChoresKillSwitch: readNoGpuComputeFlag(),
        gpuChoresGpuEligible: context.gpuChores?.eligible ?? true,
        gpuChoresIneligibleReason: context.gpuChores?.reason,
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
    flags?: CanvasOutputFlags;
    /** `matchMedia('(dynamic-range: high)')` — only consulted for `?hdr=auto`. */
    displaySupportsHdr?: boolean;
    /** `matchMedia('(color-gamut: p3)')` — only consulted for `?p3=auto`. */
    displaySupportsP3?: boolean;
}

export interface CanvasOutputPolicy {
    hdr: boolean;
    p3: boolean;
}

/**
 * Resolve the output-referred canvas policy. Both opt-ins default off, so a
 * default boot is byte-identical to the historical SDR sRGB opaque swap-chain.
 *
 * HDR needs nothing but an `rgba16float` swap chain, which every WebGPU
 * implementation accepts as a canvas format — no optional feature. (It used to
 * be gated on `float32-filterable`, which no HDR path reads, and that refused
 * HDR on most mobile adapters.) Whether the browser actually honours extended
 * tone mapping is decided by `configureCanvasContext`, which falls back to SDR
 * and records the reason when the configure is rejected.
 */
export function resolveCanvasOutputPolicy(input: CanvasOutputPolicyInput): CanvasOutputPolicy {
    const flags = input.flags ?? { hdr: 'off', p3: 'off' };
    const hdr = flags.hdr === 'on' || (flags.hdr === 'auto' && input.displaySupportsHdr === true);
    const p3 = flags.p3 === 'on' || (flags.p3 === 'auto' && input.displaySupportsP3 === true);
    return { hdr, p3 };
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
