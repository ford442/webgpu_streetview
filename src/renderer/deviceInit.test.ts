import { describe, expect, it, vi } from 'vitest';
import {
    attachUncapturedErrorHandler,
    buildCanvasConfiguration,
    buildCapabilityMatrix,
    CANVAS_USAGE,
    checkGpuChoresLimits,
    checkRequiredLimits,
    collectOptionalDeviceFeatures,
    configureCanvasContext,
    describeAdapterSelection,
    HDR_CANVAS_FORMAT,
    labelDevice,
    readNoClipDistancesFlag,
    resolveCanvasOutputPolicy,
} from './deviceInit';
import { buildAdapterRequestOptions, type AdapterSelectionPolicy } from './RendererBackend';
import { CHORES_WORKGROUP_SIZE } from './gpuChores/lumaMath';
import { COMPUTE_CHORES_WORKGROUP_SIZE, COMPUTE_WEATHER_WORKGROUP_SIZE, DEVICE_LABELS, OPTIONAL_FEATURES_ATTEMPTED, TIMESTAMP_QUERY_INSIDE_PASSES } from './deviceCapabilities';

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

    it('chores workgroup constant is one number across the limit gate, dispatch math and WGSL', async () => {
        expect(COMPUTE_CHORES_WORKGROUP_SIZE).toBe(CHORES_WORKGROUP_SIZE);
        const { readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const n = COMPUTE_CHORES_WORKGROUP_SIZE;
        for (const file of ['gpu-chores-hist.wgsl', 'gpu-chores-hist-subgroups.wgsl', 'gpu-chores-downsample.wgsl']) {
            const src = readFileSync(join(process.cwd(), 'public/shaders', file), 'utf8');
            expect(src, file).toMatch(new RegExp(`@workgroup_size\\(\\s*${n}\\s*,\\s*${n}\\s*,\\s*1\\s*\\)`));
        }
    });

    it('fragment boot with workgroup max below 8 passes the weather gate', () => {
        const adapter = makeAdapter({ maxComputeWorkgroupSizeX: 4, maxComputeWorkgroupSizeY: 4 });
        const result = checkRequiredLimits(adapter, 'fragment');
        expect(result.ok).toBe(true);
        expect(result.requiredLimits).toEqual({ maxTextureDimension2D: 4096 });
    });

    it('fragment boot with workgroup max below 8 marks chores GPU-ineligible', () => {
        const adapter = makeAdapter({ maxComputeWorkgroupSizeX: 4, maxComputeWorkgroupSizeY: 4 });
        const result = checkRequiredLimits(adapter, 'fragment');
        expect(result.gpuChores.eligible).toBe(false);
        expect(result.gpuChores.reason).toMatch(/maxComputeWorkgroupSizeX=4/);

        const matrix = buildCapabilityMatrix('fragment', result.requiredLimits!, [], {
            gpuChores: result.gpuChores,
        });
        expect(matrix.gpuChoresGpuEligible).toBe(false);
        expect(matrix.gpuChoresIneligibleReason).toMatch(/gpu-chores 8/);
        // Same end state as ?no_gpu_compute, without flipping the kill switch.
        expect(matrix.gpuChoresKillSwitch).toBe(false);

        const invocations = checkGpuChoresLimits(
            makeAdapter({ maxComputeInvocationsPerWorkgroup: 63 }).limits,
        );
        expect(invocations.eligible).toBe(false);
        expect(invocations.reason).toMatch(/maxComputeInvocationsPerWorkgroup/);
    });

    it('compute boot still fails the 16×16 gate on an adapter chores can run', () => {
        const adapter = makeAdapter({
            maxComputeWorkgroupSizeX: 8,
            maxComputeWorkgroupSizeY: 8,
            maxComputeInvocationsPerWorkgroup: 64,
        });
        const result = checkRequiredLimits(adapter, 'compute');
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/maxComputeWorkgroupSizeX=8 below required 16/);
        expect(result.gpuChores.eligible).toBe(true);
    });

    it('an adapter at 8 but not 16 boots fragment weather with chores eligible', () => {
        const adapter = makeAdapter({
            maxComputeWorkgroupSizeX: 8,
            maxComputeWorkgroupSizeY: 8,
            maxComputeInvocationsPerWorkgroup: 64,
        });
        const result = checkRequiredLimits(adapter, 'fragment');
        expect(result.ok).toBe(true);
        expect(result.gpuChores).toEqual({ eligible: true });
        expect(result.requiredLimits).toEqual({
            maxTextureDimension2D: 4096,
            maxComputeWorkgroupSizeX: 8,
            maxComputeWorkgroupSizeY: 8,
            maxComputeInvocationsPerWorkgroup: 64,
        });
        const matrix = buildCapabilityMatrix('fragment', result.requiredLimits!, [], {
            gpuChores: result.gpuChores,
        });
        expect(matrix.gpuChoresGpuEligible).toBe(true);
        expect(matrix.gpuChoresIneligibleReason).toBeUndefined();
    });

    it('compute boot keeps the stricter 16×16 + 64KiB limits in the contract', () => {
        const result = checkRequiredLimits(makeAdapter({}), 'compute');
        expect(result.requiredLimits).toEqual({
            maxTextureDimension2D: 4096,
            maxStorageBufferBindingSize: 65536,
            maxBufferSize: 65536,
            maxComputeWorkgroupSizeX: 16,
            maxComputeWorkgroupSizeY: 16,
            maxComputeInvocationsPerWorkgroup: 256,
        });
    });

    it('collectOptionalDeviceFeatures requests float32-filterable and timestamp-query when present', () => {
        const features = collectOptionalDeviceFeatures(
            makeAdapter({}, ['float32-filterable', 'timestamp-query']),
        );
        expect(features).toContain('float32-filterable');
        expect(features).toContain('timestamp-query');
    });

    it('collectOptionalDeviceFeatures requests the v3 optional set when the adapter exposes them', () => {
        const all = [
            'float32-filterable',
            'timestamp-query',
            TIMESTAMP_QUERY_INSIDE_PASSES,
            'subgroups',
            'shader-f16',
            'rg11b10ufloat-renderable',
            'dual-source-blending',
            'clip-distances',
            'core-features-and-limits',
        ] as GPUFeatureName[];
        const features = collectOptionalDeviceFeatures(makeAdapter({}, all), { featureLevel: 'core' });
        expect(features).toEqual(all);
    });

    it('collectOptionalDeviceFeatures skips names the adapter does not expose', () => {
        const features = collectOptionalDeviceFeatures(
            makeAdapter({}, ['float32-filterable']),
            { featureLevel: 'core' },
        );
        expect(features).toEqual(['float32-filterable']);
    });

    it('collectOptionalDeviceFeatures still requests clip-distances by default — the windshield portal depends on it', () => {
        const features = collectOptionalDeviceFeatures(makeAdapter({}, ['clip-distances', 'subgroups']));
        expect(features).toContain('clip-distances');
    });

    it('collectOptionalDeviceFeatures leaves clip-distances out under the ?no_clip_distances kill switch, and only that', () => {
        const features = collectOptionalDeviceFeatures(
            makeAdapter({}, ['clip-distances', 'subgroups', 'float32-filterable']),
            { enableClipDistances: false },
        );
        expect(features).not.toContain('clip-distances');
        expect(features).toContain('subgroups');
        expect(features).toContain('float32-filterable');
    });

    it.each([
        ['?no_clip_distances', true],
        ['?no_clip_distances=1', true],
        ['?no_clip_distances=true', true],
        ['no_clip_distances', true],
        ['?no_clip_distances=0', false],
        ['?no_clip_distances=false', false],
        ['?no_clip_distances=off', false],
        ['?portal=off', false],
        ['', false],
    ])('readNoClipDistancesFlag(%j) -> %s', (search, expected) => {
        expect(readNoClipDistancesFlag(search)).toBe(expected);
    });

    it('collectOptionalDeviceFeatures skips core-features-and-limits under ?gpu=compat', () => {
        const features = collectOptionalDeviceFeatures(
            makeAdapter({}, ['core-features-and-limits', 'subgroups']),
            { featureLevel: 'compatibility' },
        );
        expect(features).toContain('subgroups');
        expect(features).not.toContain('core-features-and-limits');
    });

    it('collectOptionalDeviceFeatures skips timestamp-query when disabled', () => {
        const features = collectOptionalDeviceFeatures(
            makeAdapter({}, ['float32-filterable', 'timestamp-query', TIMESTAMP_QUERY_INSIDE_PASSES]),
            { enableTimestampQueries: false },
        );
        expect(features).toContain('float32-filterable');
        expect(features).not.toContain('timestamp-query');
        expect(features).not.toContain(TIMESTAMP_QUERY_INSIDE_PASSES);
    });

    it('buildCapabilityMatrix documents compute temporal depth and timestamp availability', () => {
        const features = ['float32-filterable', 'timestamp-query'] as GPUFeatureName[];
        const matrix = buildCapabilityMatrix('compute', { maxTextureDimension2D: 4096 }, features);
        expect(matrix.temporalDepthPingPong).toBe(true);
        expect(matrix.timestampQueriesAvailable).toBe(true);
        expect(matrix.optionalFeaturesEnabled).toEqual(features);
        expect(matrix.optionalFeaturesAttempted).toEqual(OPTIONAL_FEATURES_ATTEMPTED);
        expect(matrix.intermediateFormat).toBe('rgba16float');
        expect(matrix.shaderFeatureUses.shaderF16).toBe(false);
        expect(matrix.shaderFeatureUses.subgroups).toBe(false);
    });
});

describe('adapter request options v2', () => {
    const selection = (overrides: Partial<AdapterSelectionPolicy> = {}): AdapterSelectionPolicy => ({
        forceFallbackAdapter: false,
        featureLevel: 'core',
        featureLevelSource: 'default',
        ...overrides,
    });

    it('omits featureLevel when the browser does not expose the field', () => {
        const options = buildAdapterRequestOptions('high-performance', selection(), false);
        expect(options).toEqual({ powerPreference: 'high-performance' });
        expect('featureLevel' in options).toBe(false);
    });

    it('emits core by default and compatibility for ?gpu=compat when supported', () => {
        expect(buildAdapterRequestOptions(undefined, selection(), true))
            .toEqual({ featureLevel: 'core' });
        expect(buildAdapterRequestOptions(undefined, selection({ featureLevel: 'compatibility', featureLevelSource: 'url' }), true))
            .toEqual({ featureLevel: 'compatibility' });
    });

    it('plumbs forceFallbackAdapter from ?gpu=fallback', () => {
        const options = buildAdapterRequestOptions('low-power', selection({ forceFallbackAdapter: true }), false);
        expect(options).toEqual({ powerPreference: 'low-power', forceFallbackAdapter: true });
    });

    it('describeAdapterSelection reports unknown featureLevel when it was not sent', () => {
        expect(describeAdapterSelection({ powerPreference: 'high-performance' }))
            .toEqual({ featureLevel: 'unknown', forceFallbackAdapter: false });
        expect(describeAdapterSelection({ featureLevel: 'compatibility', forceFallbackAdapter: true } as GPURequestAdapterOptions))
            .toEqual({ featureLevel: 'compatibility', forceFallbackAdapter: true });
    });
});

describe('canvas output policy', () => {
    const device = { label: '' } as unknown as GPUDevice;

    it('defaults to the historical SDR sRGB opaque configuration', () => {
        const policy = resolveCanvasOutputPolicy({ preferredFormat: 'bgra8unorm' });
        expect(policy).toEqual({ hdr: false, p3: false });

        const descriptor = buildCanvasConfiguration(device, 'bgra8unorm', policy);
        expect(descriptor.format).toBe('bgra8unorm');
        expect(descriptor.alphaMode).toBe('opaque');
        expect(descriptor.colorSpace).toBe('srgb');
        expect(descriptor.usage).toBe(CANVAS_USAGE);
        expect(descriptor.toneMapping).toBeUndefined();
        expect(descriptor.viewFormats).toBeUndefined();
    });

    // Spec values — jsdom has no GPUTextureUsage global, which is exactly the
    // environment CANVAS_USAGE's literal fallback exists for.
    const COPY_SRC = 0x01;
    const RENDER_ATTACHMENT = 0x10;

    it('keeps COPY_SRC in the swap-chain usage (cinema capture + snapshots)', () => {
        expect(CANVAS_USAGE & COPY_SRC).toBeTruthy();
        expect(CANVAS_USAGE & RENDER_ATTACHMENT).toBeTruthy();
    });

    it('?hdr=1 with float32-filterable flips format and tone mapping', () => {
        const policy = resolveCanvasOutputPolicy({
            preferredFormat: 'bgra8unorm',
            enabledFeatures: ['float32-filterable' as GPUFeatureName],
            flags: { hdr: 'on', p3: 'off' },
        });
        expect(policy.hdr).toBe(true);

        const descriptor = buildCanvasConfiguration(device, 'bgra8unorm', policy);
        expect(descriptor.format).toBe(HDR_CANVAS_FORMAT);
        expect(descriptor.toneMapping).toEqual({ mode: 'extended' });
        expect(descriptor.usage).toBe(CANVAS_USAGE);
    });

    it('?hdr=1 soft-logs and stays SDR without float32-filterable', () => {
        const policy = resolveCanvasOutputPolicy({
            preferredFormat: 'bgra8unorm',
            enabledFeatures: [],
            flags: { hdr: 'on', p3: 'off' },
        });
        expect(policy.hdr).toBe(false);
        expect(policy.hdrRejectedReason).toMatch(/float32-filterable/);
    });

    it('?p3=1 selects display-p3, ?p3=auto follows the display', () => {
        expect(resolveCanvasOutputPolicy({
            preferredFormat: 'bgra8unorm',
            flags: { hdr: 'off', p3: 'on' },
        }).p3).toBe(true);

        expect(resolveCanvasOutputPolicy({
            preferredFormat: 'bgra8unorm',
            flags: { hdr: 'off', p3: 'auto' },
            displaySupportsP3: false,
        }).p3).toBe(false);

        expect(resolveCanvasOutputPolicy({
            preferredFormat: 'bgra8unorm',
            flags: { hdr: 'off', p3: 'auto' },
            displaySupportsP3: true,
        }).p3).toBe(true);

        expect(buildCanvasConfiguration(device, 'bgra8unorm', { hdr: false, p3: true }).colorSpace)
            .toBe('display-p3');
    });

    it('falls back to SDR when the browser rejects the HDR configure', () => {
        const configure = vi.fn()
            .mockImplementationOnce(() => { throw new Error('unsupported toneMapping'); })
            .mockImplementationOnce(() => undefined);
        const context = { configure } as unknown as GPUCanvasContext;

        const applied = configureCanvasContext(context, device, 'bgra8unorm', { hdr: true, p3: true });

        expect(configure).toHaveBeenCalledTimes(2);
        expect(applied.format).toBe('bgra8unorm');
        expect(applied.colorSpace).toBe('srgb');
        expect(applied.toneMapping).toBe('standard');
        expect(applied.downgradeReason).toMatch(/unsupported toneMapping/);
        expect(configure.mock.calls[1]?.[0].usage).toBe(CANVAS_USAGE);
    });
});

describe('uncaptured errors and labels', () => {
    it('counts uncaptured errors onto the capability matrix', () => {
        let onUncapturedError: ((event: Event) => void) | undefined;
        const device = {
            addEventListener: (type: string, handler: (event: Event) => void) => {
                if (type === 'uncapturederror') onUncapturedError = handler;
            },
        } as unknown as GPUDevice;
        const matrix = buildCapabilityMatrix('fragment', { maxTextureDimension2D: 4096 }, []);

        attachUncapturedErrorHandler(device, matrix);
        expect(matrix.uncapturedErrorCount).toBe(0);

        onUncapturedError?.({ error: new Error('binding 3 out of range') } as unknown as Event);

        expect(matrix.uncapturedErrorCount).toBe(1);
        expect(matrix.lastUncapturedError).toMatch(/binding 3 out of range/);
    });

    it('labels the device and its queue', () => {
        const device = { label: '', queue: { label: '' } } as unknown as GPUDevice;
        labelDevice(device);
        expect(device.label).toBe(DEVICE_LABELS.device);
        expect(device.queue.label).toBe(DEVICE_LABELS.queue);
    });

    it('records packed HDR intermediate on the capability matrix when the feature is enabled', () => {
        const features = ['rg11b10ufloat-renderable'] as GPUFeatureName[];
        const matrix = buildCapabilityMatrix('fragment', { maxTextureDimension2D: 4096 }, features, {
            intermediateFormat: 'rg11b10ufloat',
        });
        expect(matrix.intermediateFormat).toBe('rg11b10ufloat');
        expect(matrix.shaderFeatureUses.rg11b10Intermediate).toBe(true);
        expect(matrix.shaderFeatureUses.dualSourcePrecip).toBe(false);
    });

    it('records adapter and canvas policy on the capability matrix', () => {
        const matrix = buildCapabilityMatrix('fragment', { maxTextureDimension2D: 4096 }, [], {
            featureLevel: 'compatibility',
            forceFallbackAdapter: true,
            canvas: {
                format: HDR_CANVAS_FORMAT,
                colorSpace: 'display-p3',
                toneMapping: 'extended',
                viewFormats: [],
            },
        });
        expect(matrix.featureLevel).toBe('compatibility');
        expect(matrix.forceFallbackAdapter).toBe(true);
        expect(matrix.canvasFormat).toBe(HDR_CANVAS_FORMAT);
        expect(matrix.canvasColorSpace).toBe('display-p3');
        expect(matrix.canvasToneMapping).toBe('extended');
        expect(matrix.uncapturedErrorCount).toBe(0);
        expect(matrix.gpuChoresWorkgroupSize).toBe(8);
        expect(matrix.gpuChoresKillSwitch).toBe(false);
        expect(matrix.intermediateFormat).toBe('rgba16float');
        expect(matrix.shaderFeatureUses.shaderF16).toBe(false);
    });
});

describe('single device contract', () => {
    it('creates exactly one GPUDevice across the renderer sources (#216 chores share it)', async () => {
        const { readdirSync, readFileSync } = await import('fs');
        const { join } = await import('path');

        const roots = ['src/renderer', 'src/utils', 'src/hooks', 'src/components'];
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
                    if (readFileSync(full, 'utf8').includes('requestDevice(')) hits.push(full);
                }
            }
        };
        for (const root of roots) walk(root);

        expect(hits).toEqual(['src/renderer/bootDevice.ts']);
    });
});
