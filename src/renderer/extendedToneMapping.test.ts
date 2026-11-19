/**
 * `?hdr=1` must not ACES-crush the swap-chain path, and a default SDR boot must
 * stay on the historical curve. These tests drive the two real pipeline-create
 * paths (fragment `WeatherPostProcessor.init` and the compute pipeline factory)
 * against a recording fake device, serve `public/shaders` by URL, and check
 * which linked variant was fetched and that it was compiled byte for byte.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WeatherPostProcessor } from './WeatherPostProcessor';
import { createWeatherComputePipeline } from './computeWeather/pipeline';
import { DUAL_SOURCE_PRECIP_BLEND } from './shaderFeatureVariants';
import { installGpuGlobals } from './computeWeather/__tests__/fakeGpu';

const SHADER_ROOT = join(__dirname, '..', '..', 'public', 'shaders');
const linked = (file: string) => readFileSync(join(SHADER_ROOT, file), 'utf8');

/** Just enough GPUDevice to build a pipeline, remembering every compiled module and render pipeline. */
function createShaderRecordingDevice(features: string[] = []): {
    device: GPUDevice;
    modules: string[];
    pipelines: GPURenderPipelineDescriptor[];
} {
    const modules: string[] = [];
    const pipelines: GPURenderPipelineDescriptor[] = [];
    const stub = (kind: string) => ({ kind, getBindGroupLayout: () => ({ kind: 'bgl' }) });
    const device = {
        features: { has: (f: string) => features.includes(f) },
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
        createRenderPipeline: (d: GPURenderPipelineDescriptor) => {
            pipelines.push(d);
            return stub('renderPipeline');
        },
        createComputePipeline: () => stub('computePipeline'),
    } as unknown as GPUDevice;
    return { device, modules, pipelines };
}

/** Serves public/shaders/<file> for any URL ending in /shaders/<file>; records what was asked for. */
function serveLinkedShaders(): string[] {
    const fetched: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const file = String(url).split('/shaders/').pop()!;
            fetched.push(file);
            return { ok: true, status: 200, statusText: 'OK', text: async () => linked(file) };
        }),
    );
    return fetched;
}

describe('applied canvas tone mapping drives the weather grade', () => {
    let fetched: string[];
    beforeEach(() => {
        // jsdom has no WebGPU enum globals; the bind-group layouts read them.
        installGpuGlobals();
        fetched = serveLinkedShaders();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('fragment weather path', () => {
        const init = async (features: string[], options?: Parameters<WeatherPostProcessor['init']>[1]) => {
            const recording = createShaderRecordingDevice(features);
            const post = new WeatherPostProcessor(recording.device, {} as GPUCanvasContext, {} as HTMLCanvasElement);
            await post.init(options?.canvasToneMapping === 'extended' ? 'rgba16float' : 'bgra8unorm', options);
            return recording;
        };

        it('compiles the default variant — the historical SDR ACES — by default', async () => {
            const { modules } = await init([]);
            expect(fetched).toEqual(['weather-post.wgsl']);
            expect(modules).toEqual([linked('weather-post.wgsl')]);
            expect(modules[0]).not.toContain('headroom');
        });

        it('compiles the same SDR variant when the canvas stayed standard', async () => {
            const { modules } = await init([], { canvasToneMapping: 'standard' });
            expect(fetched).toEqual(['weather-post.wgsl']);
            expect(modules[0]).toBe(linked('weather-post.wgsl'));
        });

        it('compiles the output-referred grade when the canvas is extended', async () => {
            const { modules } = await init([], { canvasToneMapping: 'extended' });
            expect(fetched).toEqual(['weather-post.hdr_grade.wgsl']);
            expect(modules[0]).toBe(linked('weather-post.hdr_grade.wgsl'));
            expect(modules[0]).toContain('let x = color / headroom;');
        });

        it('takes the dual-source variant, and its blend, only when the device enabled the feature', async () => {
            const { modules, pipelines } = await init(['dual-source-blending'], { canvasToneMapping: 'extended' });
            expect(fetched).toEqual(['weather-post.dual_source.hdr_grade.wgsl']);
            expect(modules[0]).toMatch(/^enable dual_source_blending;$/m);
            expect([...pipelines[0]!.fragment!.targets][0]!.blend).toEqual(DUAL_SOURCE_PRECIP_BLEND);

            fetched.length = 0;
            const scalar = await init([]);
            expect([...scalar.pipelines[0]!.fragment!.targets][0]!.blend).toBeUndefined();
        });
    });

    describe('compute weather path', () => {
        it('keeps the SDR variant when no tone mapping is passed', async () => {
            const { device, modules } = createShaderRecordingDevice();
            await createWeatherComputePipeline(device, '/shaders', {} as GPUBindGroupLayout);
            expect(fetched).toEqual(['weather-post-compute.wgsl']);
            expect(modules[0]).toBe(linked('weather-post-compute.wgsl'));
        });

        it('swaps in the output-referred grade for an extended canvas', async () => {
            const { device, modules } = createShaderRecordingDevice(['subgroups']);
            await createWeatherComputePipeline(device, '/shaders', {} as GPUBindGroupLayout, 'extended');
            expect(fetched).toEqual(['weather-post-compute.hdr_grade.wgsl']);
            expect(modules[0]).toBe(linked('weather-post-compute.hdr_grade.wgsl'));
            expect(modules[0]).toContain('let x = color / headroom;');
            // No directive on the compute pass, with or without subgroups.
            expect(modules[0]).not.toMatch(/^enable /m);
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
