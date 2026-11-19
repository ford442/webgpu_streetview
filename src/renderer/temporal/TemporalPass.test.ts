// @vitest-environment jsdom
/**
 * `TemporalPass` against the recording fake device: what it builds, what each
 * frame encodes in which order, which history it reads and writes, and when
 * it refuses history. The WGSL itself runs in e2e/temporal.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bindingTexture,
    createFakeGpu,
    installGpuGlobals,
    installShaderFetch,
    type FakeGpu,
    type FakeTexture,
    type RecordedBindGroup,
    type RecordedPass,
} from '../computeWeather/__tests__/fakeGpu';
import { TemporalPass } from './TemporalPass';
import { MOTION_UNIFORM_FLOAT_COUNT } from './motionMath';
import { TEMPORAL_HISTORY_FORMAT, TemporalUniformIndex } from './temporalMath';

let gpu: FakeGpu;
const depthGroup = {} as GPUBindGroup;
const motionUniforms = new Float32Array(MOTION_UNIFORM_FLOAT_COUNT);

async function ready(): Promise<TemporalPass> {
    const pass = new TemporalPass(gpu.device);
    await pass.init('bgra8unorm', { peak: 1 });
    expect(pass.isReady()).toBe(true);
    return pass;
}

const live = (label: string) => gpu.textures.filter((t) => t.descriptor.label === label && !t.destroyed);
const swapChain = () => gpu.context.getCurrentTexture().createView();
const groupTexture = (pass: RecordedPass, binding: number) =>
    bindingTexture((pass.bindGroups[0]!.group as RecordedBindGroup).entries.get(binding));
const target = (pass: RecordedPass | undefined) => bindingTexture(pass?.targets[0]);

/** One frame: the weather pass's target, then the encode. Returns this frame's passes. */
function frame(pass: TemporalPass, history: boolean, jitter: [number, number] = [0.25, -0.25]): RecordedPass[] {
    pass.ensureInput(48, 27);
    pass.setFrame({ motionUniforms, jitter, history });
    gpu.encoders.length = 0;
    const encoder = gpu.device.createCommandEncoder();
    expect(pass.encode(encoder, swapChain(), 80, 45, depthGroup)).toBe(true);
    return gpu.allPasses();
}

/** The `TemporalUniforms` the last resolve was handed. */
function lastTemporalUniforms(): Float32Array {
    const call = gpu.writeBufferCalls.filter((c) => c.buffer.descriptor.label === 'temporal-uniforms').at(-1)!;
    return call.data as Float32Array;
}

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    gpu = createFakeGpu();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('TemporalPass', () => {
    it('builds the motion, resolve and present pipelines, labelled, through the checked factory', async () => {
        await ready();
        expect(gpu.renderPipelines.map((p) => p.label).sort()).toEqual([
            'motion-pipeline', 'temporal-present-pipeline', 'temporal-resolve-pipeline',
        ]);
    });

    it('a shader that does not load fails init — nothing half built', async () => {
        const realFetch = globalThis.fetch;
        (globalThis as Record<string, unknown>).fetch = async (url: string) => (
            String(url).includes('temporal.wgsl')
                ? { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
                : realFetch(url)
        );
        const pass = new TemporalPass(gpu.device);
        await expect(pass.init('bgra8unorm', { peak: 1 })).rejects.toThrow();
        expect(pass.isReady()).toBe(false);
        expect(pass.ensureInput(48, 27)).toBeUndefined();
    });

    it('the road target is the intermediate size in the swap chain format; nothing encodes before setFrame', async () => {
        const pass = await ready();
        expect(pass.encode(gpu.device.createCommandEncoder(), swapChain(), 80, 45, depthGroup)).toBe(false);
        pass.ensureInput(48, 27);
        const [input] = live('temporal-input');
        expect(input!.descriptor).toMatchObject({ size: [48, 27], format: 'bgra8unorm' });
        expect(pass.encode(gpu.device.createCommandEncoder(), swapChain(), 80, 45, depthGroup)).toBe(false);
    });

    it('a frame is motion → resolve (into a history) → present (RCAS of that history, into the swap chain)', async () => {
        const pass = await ready();
        const passes = frame(pass, false);
        expect(passes.map((p) => p.label)).toEqual(['motion', 'temporal-resolve', 'temporal-present']);
        const [motion, resolve, present] = passes as [RecordedPass, RecordedPass, RecordedPass];
        const [motionField] = live('motion-field');
        expect(motionField!.descriptor).toMatchObject({ size: [48, 27] });
        expect(target(motion)).toBe(motionField);
        const histories = [...live('temporal-history-0'), ...live('temporal-history-1')];
        for (const h of histories) expect(h.descriptor).toMatchObject({ size: [80, 45], format: TEMPORAL_HISTORY_FORMAT });
        // The resolve reads this frame's road and field, writes one history…
        expect(groupTexture(resolve, 0)).toBe(live('temporal-input')[0]);
        expect(groupTexture(resolve, 2)).toBe(motionField);
        const written = target(resolve)!;
        expect(histories).toContain(written);
        // …and the present shows exactly that history.
        expect(groupTexture(present, 0)).toBe(written);
        expect(target(present)).toBe(gpu.context.getCurrentTexture() as unknown as FakeTexture);
        expect(present.pipeline).not.toBe(resolve.pipeline);
    });

    it('ping-pongs: each frame reads the history the last one wrote', async () => {
        const pass = await ready();
        const first = frame(pass, false)[1]!;
        const second = frame(pass, true)[1]!;
        const third = frame(pass, true)[1]!;
        expect(groupTexture(second, 1)).toBe(target(first));
        expect(groupTexture(third, 1)).toBe(target(second));
        expect(target(third)).toBe(target(first));
        expect(target(second)).not.toBe(target(first));
    });

    it('blends history only when asked and when there is one: never on the first frame, a reset or a resize', async () => {
        const pass = await ready();
        const I = TemporalUniformIndex;
        frame(pass, true, [0.1, 0.2]);
        expect(lastTemporalUniforms()[I.history]).toBe(0);
        expect([lastTemporalUniforms()[I.jitterX], lastTemporalUniforms()[I.jitterY]]).toEqual([
            Math.fround(0.1), Math.fround(0.2),
        ]);
        frame(pass, true);
        expect(lastTemporalUniforms()[I.history]).toBe(1);
        frame(pass, false);
        expect(lastTemporalUniforms()[I.history]).toBe(0);
        frame(pass, true);
        expect(lastTemporalUniforms()[I.history]).toBe(1);

        pass.resetHistory();
        frame(pass, true);
        expect(lastTemporalUniforms()[I.history]).toBe(0);

        // A new output size: new histories, and the first frame on them stands alone.
        frame(pass, true);
        pass.ensureInput(48, 27);
        pass.setFrame({ motionUniforms, jitter: [0, 0], history: true });
        pass.encode(gpu.device.createCommandEncoder(), swapChain(), 96, 54, depthGroup);
        expect(lastTemporalUniforms()[I.history]).toBe(0);
        expect(live('temporal-history-0')[0]!.descriptor.size).toEqual([96, 54]);
        expect(gpu.textures.filter((t) => t.descriptor.label?.startsWith('temporal-history') && t.destroyed)).toHaveLength(2);
    });

    it('times the resolve and the present as one span', async () => {
        const pass = await ready();
        const timer = {
            renderPassTimestampWrites: vi.fn((begin?: number, end?: number) => ({ querySet: {}, beginningOfPassWriteIndex: begin, endOfPassWriteIndex: end })),
            markPassStart: vi.fn(),
            markPassEnd: vi.fn(),
        };
        pass.ensureInput(48, 27);
        pass.setFrame({ motionUniforms, jitter: [0, 0], history: false });
        gpu.encoders.length = 0;
        pass.encode(gpu.device.createCommandEncoder(), swapChain(), 80, 45, depthGroup, {
            timer: timer as never, startIndex: 6, endIndex: 7,
        });
        const [, resolve, present] = gpu.allPasses();
        expect(resolve!.timestampWrites).toMatchObject({ beginningOfPassWriteIndex: 6, endOfPassWriteIndex: undefined });
        expect(present!.timestampWrites).toMatchObject({ beginningOfPassWriteIndex: undefined, endOfPassWriteIndex: 7 });
    });

    it('dispose destroys every texture and buffer it made', async () => {
        const pass = await ready();
        frame(pass, false);
        pass.dispose();
        const own = gpu.textures.filter((t) => /^(temporal-|motion-field)/.test(t.descriptor.label ?? ''));
        expect(own.length).toBeGreaterThan(0);
        expect(own.every((t) => t.destroyed)).toBe(true);
        const buffers = gpu.buffers.filter((b) => /^(temporal-|motion-)/.test(b.descriptor.label ?? ''));
        expect(buffers.length).toBe(3);
        expect(buffers.every((b) => b.destroyed)).toBe(true);
        expect(pass.isReady()).toBe(false);
    });
});
