import type { AdapterFeatureLevel, WeatherPostProcessMode } from './RendererBackend';

/**
 * Not yet in `GPUFeatureName` for `@webgpu/types` 0.1.64. Requested only when
 * `adapter.features.has` reports it; overlay timing later, no shader change.
 */
export const TIMESTAMP_QUERY_INSIDE_PASSES =
    'timestamp-query-inside-passes' as GPUFeatureName;

/** Documented optional features — see docs/RENDERER_FALLBACK.md § Capability matrix. */
export const OPTIONAL_DEVICE_FEATURES = {
    /** Always requested when the adapter exposes it (HDR intermediate + compute weather). */
    float32Filterable: 'float32-filterable' as GPUFeatureName,
    /** Opt-in: GPU pass timings in the performance overlay (P). */
    timestampQuery: 'timestamp-query' as GPUFeatureName,
    /** Per-draw timestamps without splitting passes — overlay-only when used. */
    timestampQueryInsidePasses: TIMESTAMP_QUERY_INSIDE_PASSES,
    /** Compute weather 16×16 and gpu-chores 8×8 reductions (shader use later). */
    subgroups: 'subgroups' as GPUFeatureName,
    /** Bandwidth on weather intermediates — no WGSL f16 in this wave (naga). */
    shaderF16: 'shader-f16' as GPUFeatureName,
    /** Cheaper HDR intermediate than rgba16float when alpha is unused (later). */
    rg11b10ufloatRenderable: 'rg11b10ufloat-renderable' as GPUFeatureName,
    /** Weather composite without an extra fullscreen target (later). */
    dualSourceBlending: 'dual-source-blending' as GPUFeatureName,
    /** Cabin windshield portal if/when cabin shares this device. */
    clipDistances: 'clip-distances' as GPUFeatureName,
    /** Core limits on a compatibility adapter — skipped under `?gpu=compat`. */
    coreFeaturesAndLimits: 'core-features-and-limits' as GPUFeatureName,
} as const;

/** Names listed as attempted on the capability matrix (enabled ⊂ attempted ∩ adapter). */
export const OPTIONAL_FEATURES_ATTEMPTED: GPUFeatureName[] = [
    OPTIONAL_DEVICE_FEATURES.float32Filterable,
    OPTIONAL_DEVICE_FEATURES.timestampQuery,
    OPTIONAL_DEVICE_FEATURES.timestampQueryInsidePasses,
    OPTIONAL_DEVICE_FEATURES.subgroups,
    OPTIONAL_DEVICE_FEATURES.shaderF16,
    OPTIONAL_DEVICE_FEATURES.rg11b10ufloatRenderable,
    OPTIONAL_DEVICE_FEATURES.dualSourceBlending,
    OPTIONAL_DEVICE_FEATURES.clipDistances,
    OPTIONAL_DEVICE_FEATURES.coreFeaturesAndLimits,
];

/** Minimum workgroup size for weather-post-compute (@workgroup_size(16,16,1)). */
export const COMPUTE_WEATHER_WORKGROUP_SIZE = 16;

/** #216 gpu-chores histogram / downsample (@workgroup_size(8,8,1)). */
export const COMPUTE_CHORES_WORKGROUP_SIZE = 8;

/** Labels applied to the device/queue/swap-chain so PIX, RenderDoc and about:gpu traces are readable. */
export const DEVICE_LABELS = {
    device: 'streetview-device',
    queue: 'streetview-queue',
    swapChain: 'streetview-swapchain',
} as const;

export interface DeviceCapabilityMatrix {
    weatherPostProcessMode: WeatherPostProcessMode;
    requiredLimits: Record<string, number>;
    optionalFeaturesAttempted: GPUFeatureName[];
    optionalFeaturesEnabled: GPUFeatureName[];
    timestampQueriesAvailable: boolean;
    temporalDepthPingPong: boolean;
    /** `'unknown'` when the browser does not expose `GPURequestAdapterOptions.featureLevel`. */
    featureLevel: AdapterFeatureLevel | 'unknown';
    forceFallbackAdapter: boolean;
    canvasFormat: GPUTextureFormat;
    canvasColorSpace: 'srgb' | 'display-p3';
    canvasToneMapping: 'standard' | 'extended';
    viewFormats: GPUTextureFormat[];
    /** Reason the requested HDR/P3 configure was rejected and re-configured as SDR sRGB. */
    canvasDowngradeReason?: string;
    uncapturedErrorCount: number;
    lastUncapturedError?: string;
    /** #216 gpu-chores workgroup (histogram / downsample). Independent of weather 16×16. */
    gpuChoresWorkgroupSize: number;
    /** `?no_gpu_compute` — chores fall back to WASM/JS; weather path unchanged. */
    gpuChoresKillSwitch: boolean;
}

export interface AdapterCapabilitySummary {
    powerPreference?: GPUPowerPreference;
    weatherMode?: WeatherPostProcessMode;
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    limits: {
        maxTextureDimension2D: number;
        maxStorageBufferBindingSize: number;
        maxBufferSize: number;
        maxComputeWorkgroupSizeX: number;
        maxComputeWorkgroupSizeY: number;
        maxComputeInvocationsPerWorkgroup: number;
    };
    enabledFeatures: GPUFeatureName[];
    capabilityMatrix?: DeviceCapabilityMatrix;
}
