import {
    buildAdapterRequestOptions,
    getAdapterPowerPreferencePolicy,
    getAdapterSelectionPolicy,
    getCanvasOutputFlags,
    supportsAdapterFeatureLevel,
    type AdapterFeatureLevel,
    type CanvasOutputFlags,
    type RendererInitOptions,
    type WeatherPostProcessMode,
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
import { currentSearch, readFlag } from '../config/flags';
import { detectXrSupport } from '../xr/xrSupport';
import { readBatteryState, readDisplayCapabilities } from '../runtime/contexts';
import { readNoGpuComputeFlag } from './gpuChores/gpuChoresPolicy';
import {
    resolveHdrIntermediateFormat,
    resolveShaderFeatureUses,
} from './shaderFeatureVariants';

export interface CollectOptionalFeaturesOptions {
    /** Request timestamp-query when the adapter supports it (`?gpu_timing`). Off unless true. */
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
    featureLevel?: AdapterFeatureLevel | 'unknown' | undefined;
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
    const [powerPreference, xr] = await Promise.all([
        policy.source !== 'default' ? policy.powerPreference : resolveDefaultPowerPreference(),
        detectXrSupport(),
    ]);
    const request = buildAdapterRequestOptions(powerPreference, selection, featureLevelSupported);
    return withXrCompatible(request, xr.state === 'available');
}

/**
 * #331: ask for an XR-compatible adapter when a WebGPU-XR headset is there.
 * The device cannot be made XR-compatible after the fact, and `bootDevice` is
 * the one `requestDevice`, so this is decided at boot. A browser that cannot
 * honour it returns no adapter — `bootDevice` then retries without it.
 */
export function withXrCompatible(
    request: GPURequestAdapterOptions,
    xrCompatible: boolean,
): GPURequestAdapterOptions {
    return xrCompatible ? { ...request, xrCompatible: true } : request;
}

/**
 * Battery heuristic for the default (no `?gpu=`, no override) power preference.
 * The battery is read through `runtime/contexts.ts`, the one Battery API reader.
 */
async function resolveDefaultPowerPreference(): Promise<GPUPowerPreference> {
    const battery = await readBatteryState();
    if (battery && !battery.charging && battery.level <= 0.2) {
        return 'low-power';
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
const MIN_TEXTURE_DIMENSION_2D = 4096;
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
        requiredLimits: required,
        gpuChores,
    };
}

/**
 * `?no_clip_distances` — do not request `clip-distances` on the shared device.
 * Uniform bool grammar (see config/flags.ts).
 */
export function readNoClipDistancesFlag(search: string = currentSearch()): boolean {
    return readFlag('no_clip_distances', search);
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

    // `float32-filterable` is not requested: every r32float binding is
    // `unfilterable-float` + `textureLoad`, and an unused feature only narrows
    // the adapters a lost device can be recreated on.

    // Opt-in (`?gpu_timing`): a feature cannot be added to a live device, so
    // the overlay (P) / auto render scale read timings only when it was asked
    // for at boot; otherwise the frame-time signal drives the scale.
    const timestamps = options.enableTimestampQueries === true;
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
    /** The adapter was requested `xrCompatible` (#331). */
    xrCompatible?: boolean;
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
        xrCompatible: context.xrCompatible ?? false,
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
): Pick<CapabilityMatrixContext, 'featureLevel' | 'forceFallbackAdapter' | 'xrCompatible'> {
    const featureLevel = (requestOptions as { featureLevel?: AdapterFeatureLevel }).featureLevel;
    return {
        featureLevel: featureLevel ?? 'unknown',
        forceFallbackAdapter: requestOptions.forceFallbackAdapter === true,
        xrCompatible: requestOptions.xrCompatible === true,
    };
}

export function logAdapterCapabilities(
    adapter: GPUAdapter,
    powerPreference?: GPUPowerPreference,
    weatherPostProcessMode?: WeatherPostProcessMode,
    enabledFeatures: GPUFeatureName[] = [],
    capabilityMatrix?: DeviceCapabilityMatrix,
): void {
    // Typed since @webgpu/types 0.1.71; still optional-chained for browsers that predate it.
    const adapterInfo = adapter.info as GPUAdapterInfo | undefined;
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
        window.rendererAdapterInfo = summary;
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
    /** `(dynamic-range: high)` via `runtime/contexts.ts` — consulted for `?hdr=auto` (the default). */
    displaySupportsHdr?: boolean;
    /** `(color-gamut: p3)` via `runtime/contexts.ts` — consulted for `?p3=auto` (the default). */
    displaySupportsP3?: boolean;
}

export interface CanvasOutputPolicy {
    hdr: boolean;
    p3: boolean;
}

/**
 * Resolve the output-referred canvas policy. Both flags default to `auto`
 * (#361): an HDR / P3 display gets HDR / P3 without a flag, and an SDR sRGB
 * display (or `?hdr=0&p3=0`) is byte-identical to the historical SDR sRGB
 * opaque swap-chain. A missing `flags` argument still means all-off.
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

/**
 * Read the display-side `auto` gates through `runtime/contexts.ts` (the one
 * `matchMedia` reader); false in jsdom / SSR where matchMedia is absent.
 */
export function readDisplayOutputCapabilities(): { displaySupportsHdr: boolean; displaySupportsP3: boolean } {
    const display = readDisplayCapabilities();
    return { displaySupportsHdr: display.hdr, displaySupportsP3: display.p3 };
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
    /**
     * True when `toneMapping` / `colorSpace` come from `context.getConfiguration()`
     * (what the browser kept), false when it has no such method and the
     * descriptor is all there is to go on.
     */
    readBack: boolean;
}

/** What the browser says is configured, or null where `getConfiguration` is not shipped. */
function readBackConfiguration(context: GPUCanvasContext): Partial<CanvasConfigurationDescriptor> | null {
    const reader = (context as GPUCanvasContext & { getConfiguration?: () => unknown }).getConfiguration;
    if (typeof reader !== 'function') return null;
    try {
        return (reader.call(context) as Partial<CanvasConfigurationDescriptor> | null) ?? null;
    } catch {
        return null;
    }
}

function applied(
    context: GPUCanvasContext,
    descriptor: CanvasConfigurationDescriptor,
    downgradeReason?: string,
): AppliedCanvasConfiguration {
    const actual = readBackConfiguration(context);
    // A browser that ignores `toneMapping` keeps the standard mode: believe it, not the request.
    const toneMapping = actual
        ? (actual.toneMapping?.mode === 'extended' ? 'extended' : 'standard')
        : (descriptor.toneMapping?.mode ?? 'standard');
    const colorSpace = actual
        ? (actual.colorSpace === 'display-p3' ? 'display-p3' : 'srgb')
        : descriptor.colorSpace;
    return {
        format: actual?.format ?? descriptor.format,
        colorSpace,
        toneMapping,
        viewFormats: [...(descriptor.viewFormats ?? [])],
        readBack: actual !== null,
        ...(downgradeReason !== undefined ? { downgradeReason } : {}),
    };
}

/**
 * Configure the swap-chain and report what the browser actually kept.
 * A rejected descriptor degrades one step at a time: HDR off but P3 kept, then
 * plain SDR sRGB — a browser that cannot do HDR must not lose wide gamut with it.
 * Callers must use the returned `format` as their presentation format, since
 * the HDR path swaps it to `rgba16float`.
 */
export function configureCanvasContext(
    context: GPUCanvasContext,
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
    policy: CanvasOutputPolicy = { hdr: false, p3: false },
): AppliedCanvasConfiguration {
    const steps: CanvasOutputPolicy[] = [policy];
    if (policy.hdr && policy.p3) steps.push({ hdr: false, p3: true });
    if (policy.hdr || policy.p3) steps.push({ hdr: false, p3: false });

    let firstReason: string | undefined;
    for (let i = 0; i < steps.length; i++) {
        const descriptor = buildCanvasConfiguration(device, presentationFormat, steps[i]);
        const last = i === steps.length - 1;
        try {
            context.configure(descriptor);
            return applied(context, descriptor, firstReason);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            firstReason ??= reason;
            if (last) throw e;
            console.warn(`[Renderer] Canvas configure rejected — retrying with ${JSON.stringify(steps[i + 1])}:`, reason);
        }
    }
    throw new Error('unreachable: canvas configure produced no result');
}

/**
 * Count uncaptured validation/OOM errors and surface the latest on the capability
 * matrix (and therefore `window.rendererAdapterInfo` / the backend chip). Kept
 * separate from the `device.lost` promise so we never double-dispose.
 */
/** The two fields the handler writes; the capability matrix satisfies it. */
export type UncapturedErrorSink = Pick<DeviceCapabilityMatrix, 'uncapturedErrorCount' | 'lastUncapturedError'>;

export function attachUncapturedErrorHandler(
    device: GPUDevice,
    capabilityMatrix: UncapturedErrorSink,
): (next: UncapturedErrorSink) => void {
    let target = capabilityMatrix;
    if (typeof device.addEventListener === 'function') {
        device.addEventListener('uncapturederror', (event: Event) => {
            const error = (event as GPUUncapturedErrorEvent).error;
            const message = error.message;
            target.uncapturedErrorCount += 1;
            target.lastUncapturedError = message;
            console.error('[Renderer] uncapturederror', error);
            if (typeof window !== 'undefined') {
                const info = window.rendererAdapterInfo;
                if (info?.capabilityMatrix) {
                    info.capabilityMatrix.uncapturedErrorCount = target.uncapturedErrorCount;
                    info.capabilityMatrix.lastUncapturedError = message;
                }
            }
        });
    }
    /** Point the handler at the real matrix once it exists, carrying the early count over. */
    return (next) => {
        if (next === target) return;
        next.uncapturedErrorCount += target.uncapturedErrorCount;
        if (target.lastUncapturedError !== undefined) next.lastUncapturedError = target.lastUncapturedError;
        target = next;
    };
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
