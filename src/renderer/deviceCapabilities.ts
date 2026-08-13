import type { WeatherPostProcessMode } from './RendererBackend';

/** Documented optional features — see docs/RENDERER_FALLBACK.md § Capability matrix. */
export const OPTIONAL_DEVICE_FEATURES = {
    /** Always requested when the adapter exposes it (HDR intermediate + compute weather). */
    float32Filterable: 'float32-filterable' as GPUFeatureName,
    /** Opt-in: GPU pass timings in the performance overlay (P). */
    timestampQuery: 'timestamp-query' as GPUFeatureName,
} as const;

/** Minimum workgroup size for weather-post-compute (@workgroup_size(16,16,1)). */
export const COMPUTE_WEATHER_WORKGROUP_SIZE = 16;

export interface DeviceCapabilityMatrix {
    weatherPostProcessMode: WeatherPostProcessMode;
    requiredLimits: Record<string, number>;
    optionalFeaturesAttempted: GPUFeatureName[];
    optionalFeaturesEnabled: GPUFeatureName[];
    timestampQueriesAvailable: boolean;
    temporalDepthPingPong: boolean;
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
