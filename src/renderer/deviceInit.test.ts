import { describe, expect, it } from 'vitest';
import { checkRequiredLimits, collectOptionalDeviceFeatures, buildCapabilityMatrix } from './deviceInit';
import { COMPUTE_WEATHER_WORKGROUP_SIZE } from './deviceCapabilities';

function makeAdapter(limits: Partial<GPUSupportedLimits>, features: GPUFeatureName[] = []): GPUAdapter {
    const featureSet = new Set(features);
    return {
        limits: {
            maxTextureDimension2D: 8192,
            maxStorageBufferBindingSize: 134217728,
            maxBufferSize: 268435456,
            maxComputeWorkgroupSizeX: 256,
            maxComputeWorkgroupSizeY: 256,
            maxComputeInvocationsPerWorkgroup: 256,
            ...limits,
        },
        features: {
            has: (name: GPUFeatureName) => featureSet.has(name),
        },
    } as unknown as GPUAdapter;
}

describe('deviceInit limits and features', () => {
    it('checkRequiredLimits passes fragment mode with default texture limit', () => {
        const result = checkRequiredLimits(makeAdapter({}), 'fragment');
        expect(result.ok).toBe(true);
    });

    it('checkRequiredLimits fails when maxTextureDimension2D is too small', () => {
        const result = checkRequiredLimits(makeAdapter({ maxTextureDimension2D: 2048 }), 'fragment');
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/maxTextureDimension2D/);
    });

    it('checkRequiredLimits enforces compute workgroup minimums', () => {
        const ok = checkRequiredLimits(makeAdapter({}), 'compute');
        expect(ok.ok).toBe(true);

        const fail = checkRequiredLimits(
            makeAdapter({ maxComputeWorkgroupSizeX: COMPUTE_WEATHER_WORKGROUP_SIZE - 1 }),
            'compute',
        );
        expect(fail.ok).toBe(false);
        expect(fail.reason).toMatch(/maxComputeWorkgroupSizeX/);
    });

    it('collectOptionalDeviceFeatures requests float32-filterable and timestamp-query when present', () => {
        const features = collectOptionalDeviceFeatures(
            makeAdapter({}, ['float32-filterable', 'timestamp-query']),
        );
        expect(features).toContain('float32-filterable');
        expect(features).toContain('timestamp-query');
    });

    it('collectOptionalDeviceFeatures skips timestamp-query when disabled', () => {
        const features = collectOptionalDeviceFeatures(
            makeAdapter({}, ['float32-filterable', 'timestamp-query']),
            { enableTimestampQueries: false },
        );
        expect(features).toContain('float32-filterable');
        expect(features).not.toContain('timestamp-query');
    });

    it('buildCapabilityMatrix documents compute temporal depth and timestamp availability', () => {
        const features = ['float32-filterable', 'timestamp-query'] as GPUFeatureName[];
        const matrix = buildCapabilityMatrix('compute', { maxTextureDimension2D: 4096 }, features);
        expect(matrix.temporalDepthPingPong).toBe(true);
        expect(matrix.timestampQueriesAvailable).toBe(true);
        expect(matrix.optionalFeaturesEnabled).toEqual(features);
    });
});
