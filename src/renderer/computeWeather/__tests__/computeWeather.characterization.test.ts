import { describe, it, expect, beforeEach } from 'vitest';
import {
    createFakeGpu,
    installGpuGlobals,
    installShaderFetch,
    bindingTexture,
    bindingBuffer,
    type FakeGpu,
} from './fakeGpu';
import { ComputeWeatherPostProcessor } from '../../ComputeWeatherPostProcessor';
import { WeatherParamIndex, WEATHER_PARAMS_FLOAT_COUNT } from '../../weatherUniformLayout';

/**
 * Characterization tests for the compute weather post-process path.
 *
 * These were written against the pre-split 885-line `ComputeWeatherPostProcessor`
 * and must keep passing, byte-for-byte unchanged, across the split into
 * `computeWeather/`. They exist because that class had no runtime coverage
 * whatsoever: `weatherShaderParity.test.ts` diffs only `.wgsl` text,
 * `gpuChores.isolation.test.ts` is a source-text grep, and
 * `weatherPostProcessor.contract.test.ts` only checks method names exist.
 * Nothing asserted that binding 7 carries the density texture, that the depth
 * ping-pong actually alternates, or that the particle passes run in
 * clear -> integrate -> splat order.
 *
 * What is pinned here is the **observable GPU contract**, not internal
 * structure, so it constrains a refactor without freezing its shape.
 */

const W = 64;
const H = 32;

async function makeProcessor(gpu: FakeGpu): Promise<ComputeWeatherPostProcessor> {
    const proc = new ComputeWeatherPostProcessor(gpu.device, gpu.context, gpu.canvas);
    await proc.init('bgra8unorm');
    return proc;
}

/** The intermediate HDR texture view the renderer would hand in. */
function intermediateView(gpu: FakeGpu): GPUTextureView {
    const tex = gpu.device.createTexture({
        size: [W, H], format: 'rgba16float', usage: 0,
    } as GPUTextureDescriptor);
    return (tex as unknown as { createView: () => GPUTextureView }).createView();
}

/** The most recent 13-entry compute bind group (the weather one, not LUT/particles). */
function lastWeatherBindGroup(gpu: FakeGpu) {
    const groups = gpu.bindGroups.filter((g) => g.entries.size === 13);
    return groups[groups.length - 1]!;
}

function seedParticles(proc: ComputeWeatherPostProcessor, gridW = 4, gridH = 4): void {
    proc.updateParticleSeeds(new Float32Array(gridW * gridH * 4), gridW, gridH);
}

/** Rain must be non-zero or the particle passes short-circuit. */
function withPrecipitation(proc: ComputeWeatherPostProcessor): void {
    const params = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
    params[WeatherParamIndex.rainIntensity] = 0.8;
    proc.updateWeatherParams(params);
}

let gpu: FakeGpu;

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    gpu = createFakeGpu();
});

describe('compute weather — pipeline setup', () => {
    it('creates the weather compute pipeline and the blit render pipeline', async () => {
        await makeProcessor(gpu);
        expect(gpu.renderPipelines).toHaveLength(1);
        // main + the three particle entry points.
        const entryPoints = gpu.computePipelines.map((p) => p.entryPoint).sort();
        expect(entryPoints).toEqual(['clear_density', 'integrate', 'main', 'splat']);
    });

    it('degrades to no particle pipelines when the particle shader is missing', async () => {
        installShaderFetch({ particles: false });
        gpu = createFakeGpu();
        await makeProcessor(gpu);
        expect(gpu.computePipelines.map((p) => p.entryPoint)).toEqual(['main']);
    });
});

describe('compute weather — bind group wiring', () => {
    it('binds all 13 image_video_effects slots on the weather group', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);

        const bg = lastWeatherBindGroup(gpu);
        expect([...bg.entries.keys()].sort((a, b) => a - b))
            .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it('binds the write texture at 2 and the intermediate at 1', async () => {
        const proc = await makeProcessor(gpu);
        const view = intermediateView(gpu);
        proc.updateWeatherBindGroup(view, W, H);

        const bg = lastWeatherBindGroup(gpu);
        const write = bindingTexture(bg.entries.get(2))!;
        expect(write.descriptor.format).toBe('rgba32float');
        expect(write.descriptor.size).toEqual([W, H]);
        // Binding 1 is the caller's view, passed straight through.
        expect(bg.entries.get(1)).toBe(view);
    });

    it('binds distinct r32float depth textures at 4 (read) and 6 (write)', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);

        const bg = lastWeatherBindGroup(gpu);
        const read = bindingTexture(bg.entries.get(4))!;
        const write = bindingTexture(bg.entries.get(6))!;
        expect(read.descriptor.format).toBe('r32float');
        expect(write.descriptor.format).toBe('r32float');
        expect(read.id).not.toBe(write.id);
    });

    it('binds 1x1 dummies at 7/8 until particle seeds arrive, then the real textures', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);

        let bg = lastWeatherBindGroup(gpu);
        expect(bindingTexture(bg.entries.get(7))!.descriptor.size).toEqual([1, 1]);
        expect(bindingTexture(bg.entries.get(8))!.descriptor.size).toEqual([1, 1]);
        expect(proc.areParticleTexturesActive()).toBe(false);

        seedParticles(proc);

        bg = lastWeatherBindGroup(gpu);
        expect(bindingTexture(bg.entries.get(7))!.descriptor.size).not.toEqual([1, 1]);
        expect(bindingTexture(bg.entries.get(8))!.descriptor.size).not.toEqual([1, 1]);
        expect(proc.areParticleTexturesActive()).toBe(true);
    });

    it('binds the shared weather-params storage buffer at 10 and the noise tile at 12', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);

        const bg = lastWeatherBindGroup(gpu);
        const extra = bindingBuffer(bg.entries.get(10))!;
        const noise = bindingBuffer(bg.entries.get(12))!;
        // 40 floats = 160 bytes, the shared weather uniform layout.
        expect(extra.descriptor.size).toBe(WEATHER_PARAMS_FLOAT_COUNT * 4);
        // One 64x64 f32 noise tile.
        expect(noise.descriptor.size).toBe(64 * 64 * 4);
    });

    it('keeps colour history on a dummy until a frame has been copied', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        const bg = lastWeatherBindGroup(gpu);
        // Temporal history defaults off -> binding 9 is the 1x1 dummy.
        expect(bindingTexture(bg.entries.get(9))!.descriptor.size).toEqual([1, 1]);
    });
});

describe('compute weather — ping-pong', () => {
    it('alternates the depth read/write textures across dispatches', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);

        const before = lastWeatherBindGroup(gpu);
        const read0 = bindingTexture(before.entries.get(4))!.id;
        const write0 = bindingTexture(before.entries.get(6))!.id;

        proc.renderPass(gpu.createCommandEncoder());

        const after = lastWeatherBindGroup(gpu);
        const read1 = bindingTexture(after.entries.get(4))!.id;
        const write1 = bindingTexture(after.entries.get(6))!.id;

        // Swapped, not reallocated.
        expect(read1).toBe(write0);
        expect(write1).toBe(read0);
    });

    it('does not swap the particle ping-pong when precipitation is zero', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        seedParticles(proc);

        const before = bindingTexture(lastWeatherBindGroup(gpu).entries.get(8))!.id;
        proc.renderPass(gpu.createCommandEncoder()); // rain is 0 -> particles skipped
        const after = bindingTexture(lastWeatherBindGroup(gpu).entries.get(8))!.id;

        expect(after).toBe(before);
    });

    it('swaps the particle ping-pong once precipitation is non-zero', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        seedParticles(proc);
        withPrecipitation(proc);

        const before = bindingTexture(lastWeatherBindGroup(gpu).entries.get(8))!.id;
        proc.renderPass(gpu.createCommandEncoder());
        const after = bindingTexture(lastWeatherBindGroup(gpu).entries.get(8))!.id;

        expect(after).not.toBe(before);
    });
});

describe('compute weather — dispatch order', () => {
    it('records only the weather compute pass and the blit when particles are idle', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);

        const encoder = gpu.createCommandEncoder();
        proc.renderPass(encoder);

        const passes = gpu.lastEncoder().passes;
        expect(passes.map((p) => p.type)).toEqual(['compute', 'render']);
        expect(passes.every((p) => p.ended)).toBe(true);
    });

    it('runs clear -> integrate -> splat before the weather pass, then blits', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        seedParticles(proc);
        withPrecipitation(proc);

        const encoder = gpu.createCommandEncoder();
        proc.renderPass(encoder);

        const passes = gpu.lastEncoder().passes;
        expect(passes.map((p) => p.type))
            .toEqual(['compute', 'compute', 'compute', 'compute', 'render']);

        const byId = new Map(gpu.computePipelines.map((p) => [p.id, p.entryPoint]));
        const order = passes
            .slice(0, 4)
            .map((p) => byId.get((p.pipeline as { id: number }).id));
        expect(order).toEqual(['clear_density', 'integrate', 'splat', 'main']);
    });

    it('dispatches the weather pass over a 16x16 workgroup grid', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);

        proc.renderPass(gpu.createCommandEncoder());

        const weatherPass = gpu.lastEncoder().passes.find((p) => p.type === 'compute')!;
        expect(weatherPass.dispatches).toEqual([[Math.ceil(W / 16), Math.ceil(H / 16)]]);
    });

    it('blits with a 3-vertex fullscreen triangle', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);

        proc.renderPass(gpu.createCommandEncoder());

        const blit = gpu.lastEncoder().passes.find((p) => p.type === 'render')!;
        expect(blit.draws).toEqual([3]);
    });

    it('does nothing when no bind group has been built yet', async () => {
        const proc = await makeProcessor(gpu);
        const encoder = gpu.createCommandEncoder();
        proc.renderPass(encoder);
        expect(gpu.lastEncoder().passes).toHaveLength(0);
    });
});

describe('compute weather — temporal history', () => {
    it('does not copy colour history while temporal history is off', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        proc.renderPass(gpu.createCommandEncoder());
        expect(gpu.lastEncoder().copies).toHaveLength(0);
    });

    it('copies the write texture into history once enabled, and then binds it at 9', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        proc.setTemporalHistoryEnabled(true);

        proc.renderPass(gpu.createCommandEncoder());

        const copies = gpu.lastEncoder().copies;
        expect(copies).toHaveLength(1);
        expect(copies[0]!.size).toEqual([W, H]);

        // After the first copy, history is live and stops being the 1x1 dummy.
        const bg = lastWeatherBindGroup(gpu);
        expect(bindingTexture(bg.entries.get(9))!.descriptor.size).toEqual([W, H]);
    });
});

describe('compute weather — parameter uploads', () => {
    it('writes camera params into the shared weather buffer and reads them back', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateCameraParams(123.5, -12.25);
        expect(proc.getCameraParams()).toEqual({ heading: 123.5, pitch: -12.25 });
    });

    it('round-trips the shader-effects flag', async () => {
        const proc = await makeProcessor(gpu);
        expect(proc.getShaderEffectsEnabled()).toBe(true);
        proc.setShaderEffects(false);
        expect(proc.getShaderEffectsEnabled()).toBe(false);
    });

    it('uploads a noise tile into the binding-12 buffer', async () => {
        const proc = await makeProcessor(gpu);
        const before = gpu.writeBufferCalls.length;
        proc.updateNoiseBuffer(new Float32Array(64 * 64));
        expect(gpu.writeBufferCalls.length).toBe(before + 1);
        const last = gpu.writeBufferCalls[gpu.writeBufferCalls.length - 1]!;
        expect(last.buffer.descriptor.size).toBe(64 * 64 * 4);
    });

    it('ignores particle seeds that are too short for the grid', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        proc.updateParticleSeeds(new Float32Array(4), 8, 8); // needs 8*8*4
        expect(proc.areParticleTexturesActive()).toBe(false);
    });

    it('seeds both particle state textures so the first read is initialised', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        const before = gpu.writeTextureCalls.length;
        seedParticles(proc, 4, 4);
        expect(gpu.writeTextureCalls.length).toBe(before + 2);
    });
});

describe('compute weather — lifecycle', () => {
    it('reuses textures when the size is unchanged and reallocates when it changes', async () => {
        const proc = await makeProcessor(gpu);
        const view = intermediateView(gpu);

        proc.updateWeatherBindGroup(view, W, H);
        const first = bindingTexture(lastWeatherBindGroup(gpu).entries.get(2))!;

        proc.updateWeatherBindGroup(view, W, H);
        expect(bindingTexture(lastWeatherBindGroup(gpu).entries.get(2))!.id).toBe(first.id);

        proc.updateWeatherBindGroup(view, W * 2, H);
        const resized = bindingTexture(lastWeatherBindGroup(gpu).entries.get(2))!;
        expect(resized.id).not.toBe(first.id);
        expect(first.destroyed).toBe(true);
    });

    it('destroys every texture and buffer it owns on dispose', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        seedParticles(proc);

        proc.dispose();

        // The canvas texture and the test's own intermediate are not owned.
        const owned = gpu.textures.filter((t) => t.label !== 'canvas'
            && t.descriptor.format !== 'rgba16float');
        expect(owned.every((t) => t.destroyed)).toBe(true);
        expect(gpu.buffers.every((b) => b.destroyed)).toBe(true);
    });

    it('is safe to dispatch after dispose', async () => {
        const proc = await makeProcessor(gpu);
        proc.updateWeatherBindGroup(intermediateView(gpu), W, H);
        proc.dispose();
        expect(() => proc.renderPass(gpu.createCommandEncoder())).not.toThrow();
    });
});
