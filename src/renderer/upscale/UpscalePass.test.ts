// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bindingBuffer,
    bindingTexture,
    createFakeGpu,
    installGpuGlobals,
    installShaderFetch,
    type FakeGpu,
    type RecordedBindGroup,
} from '../computeWeather/__tests__/fakeGpu';
import { GpuPassTimer } from '../gpuPassTimer';
import {
    EASU_OUTPUT_FORMAT,
    RCAS_SHARPNESS_STOPS,
    UpscalePass,
    packUpscaleUniforms,
    type UpscaleMode,
} from './UpscalePass';

let gpu: FakeGpu;

async function ready(mode: UpscaleMode, peak = 1): Promise<UpscalePass> {
    const pass = new UpscalePass(gpu.device, mode);
    await pass.init('bgra8unorm', { peak });
    expect(pass.isReady()).toBe(true);
    return pass;
}

const live = (label: string) => gpu.textures.filter((t) => t.descriptor.label === label && !t.destroyed);
const swapChain = () => gpu.context.getCurrentTexture().createView();
const boundTexture = (pass: { bindGroups: Array<{ group: unknown }> }) =>
    bindingTexture((pass.bindGroups[0]!.group as RecordedBindGroup).entries.get(0));

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    gpu = createFakeGpu();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('packUpscaleUniforms', () => {
    it('packs sizes, the RCAS sharpness as exp2(-stops) and the peak', () => {
        const out = packUpscaleUniforms({
            inputWidth: 960, inputHeight: 540, outputWidth: 1920, outputHeight: 1080,
            sharpnessStops: 1, peak: 4,
        });
        expect([...out]).toEqual([960, 540, 1920, 1080, 0.5, 4, 0, 0]);
    });
});

describe('UpscalePass', () => {
    it('fsr builds the EASU and RCAS pipelines, labelled, through the checked factory', async () => {
        await ready('fsr');
        expect(gpu.renderPipelines.map((p) => p.label)).toEqual(['upscale-easu-pipeline', 'upscale-rcas-pipeline']);
    });

    it('bilinear builds one pipeline', async () => {
        await ready('bilinear');
        expect(gpu.renderPipelines.map((p) => p.label)).toEqual(['upscale-bilinear-pipeline']);
    });

    it('is not ready, and hands out no road target, before init', () => {
        const pass = new UpscalePass(gpu.device, 'fsr');
        expect(pass.isReady()).toBe(false);
        expect(pass.ensureInput(32, 18)).toBeUndefined();
        expect(pass.encode(gpu.createCommandEncoder(), swapChain(), 64, 36)).toBe(false);
    });

    it('the road target is the swap chain format at the scaled size, reallocated only on resize', async () => {
        const pass = await ready('fsr');
        const a = pass.ensureInput(32, 18);
        expect(pass.ensureInput(32, 18)).toBe(a);
        expect(live('upscale-input')).toHaveLength(1);
        expect(live('upscale-input')[0]!.descriptor).toMatchObject({ size: [32, 18], format: 'bgra8unorm' });

        const b = pass.ensureInput(48, 27);
        expect(b).not.toBe(a);
        expect(live('upscale-input').map((t) => t.descriptor.size)).toEqual([[48, 27]]);
    });

    it('fsr: EASU reads the road target into a float texture at output size, RCAS writes the output', async () => {
        const pass = await ready('fsr');
        pass.ensureInput(32, 18);
        const encoder = gpu.createCommandEncoder();
        const out = swapChain();
        expect(pass.encode(encoder, out, 64, 36)).toBe(true);

        const [easu, rcas] = gpu.lastEncoder().passes;
        expect([easu!.label, rcas!.label]).toEqual(['upscale-easu', 'upscale-rcas']);
        const [easuTexture] = live('upscale-easu');
        expect(easuTexture!.descriptor).toMatchObject({ size: [64, 36], format: EASU_OUTPUT_FORMAT });
        expect(boundTexture(easu!)).toBe(live('upscale-input')[0]);
        expect(bindingTexture(easu!.targets[0])).toBe(easuTexture);
        expect(boundTexture(rcas!)).toBe(easuTexture);
        expect(rcas!.targets[0]).toBe(out);
        expect(easu!.draws).toEqual([3]);
        expect(rcas!.draws).toEqual([3]);
    });

    it('bilinear: one pass from the road target to the output', async () => {
        const pass = await ready('bilinear');
        pass.ensureInput(32, 18);
        const encoder = gpu.createCommandEncoder();
        const out = swapChain();
        pass.encode(encoder, out, 64, 36);
        expect(gpu.lastEncoder().passes.map((p) => p.label)).toEqual(['upscale-bilinear']);
        expect(boundTexture(gpu.lastEncoder().passes[0]!)).toBe(live('upscale-input')[0]);
        expect(gpu.lastEncoder().passes[0]!.targets[0]).toBe(out);
        expect(live('upscale-easu')).toHaveLength(0);
    });

    it('writes its uniforms once for a steady size, again on resize', async () => {
        const pass = await ready('fsr', 4);
        const uniformWrites = () => gpu.writeBufferCalls.filter((c) => c.buffer.descriptor.label === 'upscale-uniforms');
        pass.ensureInput(32, 18);
        for (let i = 0; i < 3; i++) pass.encode(gpu.createCommandEncoder(), swapChain(), 64, 36);
        expect(uniformWrites()).toHaveLength(1);
        expect([...(uniformWrites()[0]!.data as Float32Array)]).toEqual([
            32, 18, 64, 36, Math.pow(2, -RCAS_SHARPNESS_STOPS), 4, 0, 0,
        ].map(Math.fround));

        pass.ensureInput(48, 27);
        pass.encode(gpu.createCommandEncoder(), swapChain(), 64, 36);
        expect(uniformWrites()).toHaveLength(2);
        // Every bind group binds its own uniform buffer.
        const bound = gpu.bindGroups.filter((g) => g.descriptor.label?.startsWith('upscale'));
        expect(bound.every((g) => bindingBuffer(g.entries.get(2))?.descriptor.label === 'upscale-uniforms')).toBe(true);
    });

    it('one timestamp span: EASU stamps the start, RCAS the end', async () => {
        gpu = createFakeGpu({ features: ['timestamp-query'] });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const timer = new GpuPassTimer(gpu.device);
        const pass = await ready('fsr');
        pass.ensureInput(32, 18);
        const encoder = gpu.createCommandEncoder();
        pass.encode(encoder, swapChain(), 64, 36, { timer, startIndex: 6, endIndex: 7 });

        const [easu, rcas] = gpu.lastEncoder().passes;
        expect(easu!.timestampWrites).toMatchObject({ beginningOfPassWriteIndex: 6 });
        expect(easu!.timestampWrites?.endOfPassWriteIndex).toBeUndefined();
        expect(rcas!.timestampWrites).toMatchObject({ endOfPassWriteIndex: 7 });
        expect(rcas!.timestampWrites?.beginningOfPassWriteIndex).toBeUndefined();
    });

    it('dispose releases its textures and stops being ready', async () => {
        const pass = await ready('fsr');
        pass.ensureInput(32, 18);
        pass.encode(gpu.createCommandEncoder(), swapChain(), 64, 36);
        pass.dispose();
        expect(pass.isReady()).toBe(false);
        expect(live('upscale-input')).toHaveLength(0);
        expect(live('upscale-easu')).toHaveLength(0);
    });

    it('init after dispose (a teardown racing the shader fetch) builds nothing', async () => {
        const pass = new UpscalePass(gpu.device, 'fsr');
        const init = pass.init('bgra8unorm', { peak: 1 });
        pass.dispose();
        await init;
        expect(pass.isReady()).toBe(false);
        expect(gpu.renderPipelines).toHaveLength(0);
    });
});
