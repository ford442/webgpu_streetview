/**
 * `?hdr=1` must not ACES-crush the swap-chain path, and a default SDR boot must
 * stay on the historical curve. These tests drive the two real pipeline-create
 * paths (fragment `WeatherPostProcessor.init` and the compute pipeline factory)
 * against a recording fake device and read back the WGSL that was compiled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WeatherPostProcessor } from './WeatherPostProcessor';
import { createWeatherComputePipeline } from './computeWeather/pipeline';
import { ACES_TONEMAP_SDR_BODY } from './shaderFeatureVariants';
import { installGpuGlobals } from './computeWeather/__tests__/fakeGpu';

const SHADER_ROOT = join(__dirname, '..', '..', 'public', 'shaders');
const FRAGMENT_SHADER = readFileSync(join(SHADER_ROOT, 'weather-post.wgsl'), 'utf8');
const COMPUTE_SHADER = readFileSync(join(SHADER_ROOT, 'weather-post-compute.wgsl'), 'utf8');

/** Just enough GPUDevice to build a pipeline, remembering every compiled module. */
function createShaderRecordingDevice(): { device: GPUDevice; modules: string[] } {
    const modules: string[] = [];
    const stub = (kind: string) => ({ kind, getBindGroupLayout: () => ({ kind: 'bgl' }) });
    const device = {
        // No optional features — dual-source / subgroup variants stay out of the way.
        features: { has: () => false },
        queue: { writeBuffer: () => undefined, writeTexture: () => undefined },
        createSampler: () => stub('sampler'),
        createBuffer: () => ({ ...stub('buffer'), destroy: () => undefined }),
        createTexture: () => ({
            ...stub('texture'),
            createView: () => stub('view'),
            destroy: () => undefined,
        }),
        createShaderModule: (d: GPUShaderModuleDescriptor) => {
            modules.push(d.code);
            return stub('module');
        },
        createBindGroupLayout: () => stub('bgl'),
        createPipelineLayout: () => stub('pipelineLayout'),
        createBindGroup: () => stub('bindGroup'),
        createRenderPipeline: () => stub('renderPipeline'),
        createComputePipeline: () => stub('computePipeline'),
    } as unknown as GPUDevice;
    return { device, modules };
}

function mockShaderFetch(body: string): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => body })),
    );
}

describe('applied canvas tone mapping drives the weather grade', () => {
    beforeEach(() => {
        // jsdom has no WebGPU enum globals; the bind-group layouts read them.
        installGpuGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('fragment weather path', () => {
        beforeEach(() => {
            mockShaderFetch(FRAGMENT_SHADER);
        });

        it('compiles the historical SDR ACES body by default', async () => {
            const { device, modules } = createShaderRecordingDevice();
            const post = new WeatherPostProcessor(
                device,
                {} as GPUCanvasContext,
                {} as HTMLCanvasElement,
            );
            await post.init('bgra8unorm');
            expect(modules).toHaveLength(1);
            expect(modules[0]).toBe(FRAGMENT_SHADER);
            expect(modules[0]).toContain(ACES_TONEMAP_SDR_BODY);
        });

        it('compiles the same SDR body when the canvas stayed standard', async () => {
            const { device, modules } = createShaderRecordingDevice();
            const post = new WeatherPostProcessor(
                device,
                {} as GPUCanvasContext,
                {} as HTMLCanvasElement,
            );
            await post.init('bgra8unorm', { canvasToneMapping: 'standard' });
            expect(modules[0]).toBe(FRAGMENT_SHADER);
        });

        it('compiles the output-referred grade when the canvas is extended', async () => {
            const { device, modules } = createShaderRecordingDevice();
            const post = new WeatherPostProcessor(
                device,
                {} as GPUCanvasContext,
                {} as HTMLCanvasElement,
            );
            await post.init('rgba16float', { canvasToneMapping: 'extended' });
            expect(modules[0]).not.toContain(ACES_TONEMAP_SDR_BODY);
            expect(modules[0]).toContain('let x = color / headroom;');
        });
    });

    describe('compute weather path', () => {
        beforeEach(() => {
            mockShaderFetch(COMPUTE_SHADER);
        });

        it('keeps the SDR body when no tone mapping is passed', async () => {
            const { device, modules } = createShaderRecordingDevice();
            await createWeatherComputePipeline(device, '/shaders/x.wgsl', {} as GPUBindGroupLayout);
            expect(modules[0]).toBe(COMPUTE_SHADER);
        });

        it('swaps in the output-referred grade for an extended canvas', async () => {
            const { device, modules } = createShaderRecordingDevice();
            await createWeatherComputePipeline(
                device,
                '/shaders/x.wgsl',
                {} as GPUBindGroupLayout,
                'extended',
            );
            expect(modules[0]).not.toContain(ACES_TONEMAP_SDR_BODY);
            expect(modules[0]).toContain('let x = color / headroom;');
            // The subgroup variant is the only thing allowed to prepend a directive.
            expect(modules[0]!.startsWith('enable ')).toBe(false);
        });
    });
});

describe('Renderer wiring', () => {
    it('derives the grade from the applied canvas policy, never the ?hdr flag', () => {
        const source = readFileSync(join(__dirname, 'Renderer.ts'), 'utf8');
        expect(source).toContain(
            "canvasToneMapping: this.canvasOutputPolicy.hdr ? 'extended' : 'standard',",
        );
        // bootDevice rewrites canvasOutputPolicy from what configure() accepted,
        // so a rejected HDR configure can never reach the extended grade.
        const boot = readFileSync(join(__dirname, 'bootDevice.ts'), 'utf8');
        expect(boot).toContain("hdr: appliedCanvas.toneMapping === 'extended',");
    });
});
