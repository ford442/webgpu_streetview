/**
 * The one-frame compositor's contract, against a recording fake device:
 * free-look frames must be untouched, the cabin must land on the swap chain the
 * weather pass just wrote (never a clear), and every way the cabin can be
 * missing must degrade to "road only" rather than throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    CABIN_COMPOSITE_BLEND,
    CabinCompositePass,
    needsCabinOverlayLatch,
    type CabinOverlaySource,
} from './cabinComposite';
import { encodeCabinComposite } from './frameLoop';
import {
    getCabinOverlaySource,
    publishCabinOverlaySource,
    resetCabinOverlaySourceForTests,
} from './cabinOverlayRegistry';

const SHADER = readFileSync(
    join(__dirname, '..', '..', 'public', 'shaders', 'cabin-composite.wgsl'),
    'utf8',
);

interface RecordedPass {
    colorAttachments: Array<{ view: unknown; loadOp?: string; storeOp?: string }>;
    bindGroups: unknown[];
    draws: number[];
    ended: boolean;
}

function createFakeDevice() {
    const passes: RecordedPass[] = [];
    const bindGroups: GPUBindGroupDescriptor[] = [];
    const pipelines: GPURenderPipelineDescriptor[] = [];
    const device = {
        createShaderModule: (d: GPUShaderModuleDescriptor) => ({ kind: 'module', code: d.code }),
        createSampler: () => ({ kind: 'sampler' }),
        createBindGroup: (d: GPUBindGroupDescriptor) => {
            bindGroups.push(d);
            return { kind: 'bindGroup', id: bindGroups.length };
        },
        createRenderPipeline: (d: GPURenderPipelineDescriptor) => {
            pipelines.push(d);
            return { kind: 'renderPipeline', getBindGroupLayout: () => ({ kind: 'bgl' }) };
        },
    } as unknown as GPUDevice;

    const encoder = {
        beginRenderPass: (d: GPURenderPassDescriptor) => {
            const pass: RecordedPass = {
                colorAttachments: [...(d.colorAttachments as RecordedPass['colorAttachments'])],
                bindGroups: [],
                draws: [],
                ended: false,
            };
            passes.push(pass);
            return {
                setPipeline: () => undefined,
                setBindGroup: (_i: number, g: unknown) => pass.bindGroups.push(g),
                draw: (count: number) => pass.draws.push(count),
                end: () => { pass.ended = true; },
            };
        },
    } as unknown as GPUCommandEncoder;

    return { device, encoder, passes, bindGroups, pipelines };
}

function fakeTexture(label: string) {
    return { label, createView: () => ({ kind: 'view', of: label }) } as unknown as GPUTexture;
}

function sourceFor(texture: GPUTexture | null): CabinOverlaySource {
    return { getTexture: () => texture };
}

function mockShaderFetch(): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => SHADER })),
    );
}

describe('CabinCompositePass', () => {
    beforeEach(() => {
        mockShaderFetch();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetCabinOverlaySourceForTests();
    });

    it('is inactive until init resolves', async () => {
        const { device } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        pass.setSource(sourceFor(fakeTexture('cabin')));
        expect(pass.isReady()).toBe(false);
        expect(pass.isActive()).toBe(false);
        await pass.init('bgra8unorm');
        expect(pass.isReady()).toBe(true);
        expect(pass.isActive()).toBe(true);
    });

    it('builds a premultiplied source-over pipeline on the swap-chain format', async () => {
        const { device, pipelines } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('rgba16float');
        const targets = [...pipelines[0]!.fragment!.targets];
        const target = targets[0] as GPUColorTargetState;
        expect(target.format).toBe('rgba16float');
        expect(target.blend).toEqual(CABIN_COMPOSITE_BLEND);
        expect(CABIN_COMPOSITE_BLEND.color.srcFactor).toBe('one');
        expect(CABIN_COMPOSITE_BLEND.color.dstFactor).toBe('one-minus-src-alpha');
    });

    it('loads the swap-chain view rather than clearing the graded road', async () => {
        const { device, encoder, passes } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');
        pass.setSource(sourceFor(fakeTexture('cabin')));

        const swapView = { kind: 'swapchain' } as unknown as GPUTextureView;
        expect(pass.encode(encoder, swapView)).toBe(true);

        expect(passes).toHaveLength(1);
        const attachment = passes[0]!.colorAttachments[0]!;
        expect(attachment.view).toBe(swapView);
        expect(attachment.loadOp).toBe('load');
        expect(attachment.storeOp).toBe('store');
        expect(passes[0]!.draws).toEqual([3]);
        expect(passes[0]!.ended).toBe(true);
    });

    it('encodes nothing without a source — a free-look frame is unchanged', async () => {
        const { device, encoder, passes } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');
        expect(pass.isActive()).toBe(false);
        expect(pass.encode(encoder, {} as GPUTextureView)).toBe(false);
        expect(passes).toHaveLength(0);
    });

    it('encodes nothing while the cabin has no texture yet', async () => {
        const { device, encoder, passes } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');
        pass.setSource(sourceFor(null));
        expect(pass.isActive()).toBe(false);
        expect(pass.encode(encoder, {} as GPUTextureView)).toBe(false);
        expect(passes).toHaveLength(0);
    });

    it('treats a throwing cabin as road-only instead of failing the frame', async () => {
        const { device, encoder, passes } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');
        pass.setSource({
            getTexture: () => {
                throw new Error('cabin disposed mid-frame');
            },
        });
        expect(pass.isActive()).toBe(false);
        expect(pass.encode(encoder, {} as GPUTextureView)).toBe(false);
        expect(passes).toHaveLength(0);
    });

    it('rebinds when three reallocates the cabin texture, and only then', async () => {
        const { device, encoder, bindGroups } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');

        const first = fakeTexture('first');
        const second = fakeTexture('second');
        let current = first;
        pass.setSource({ getTexture: () => current });

        pass.encode(encoder, {} as GPUTextureView);
        pass.encode(encoder, {} as GPUTextureView);
        expect(bindGroups).toHaveLength(1);

        current = second;
        pass.encode(encoder, {} as GPUTextureView);
        expect(bindGroups).toHaveLength(2);
    });

    it('drops the cached bind group when the source is replaced', async () => {
        const { device, encoder, bindGroups } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');
        const texture = fakeTexture('shared');

        pass.setSource(sourceFor(texture));
        pass.encode(encoder, {} as GPUTextureView);
        pass.setSource(sourceFor(texture));
        pass.encode(encoder, {} as GPUTextureView);
        expect(bindGroups).toHaveLength(2);
    });

    it('goes inert after dispose', async () => {
        const { device, encoder, passes } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');
        pass.setSource(sourceFor(fakeTexture('cabin')));
        pass.dispose();
        expect(pass.isReady()).toBe(false);
        expect(pass.isActive()).toBe(false);
        expect(pass.encode(encoder, {} as GPUTextureView)).toBe(false);
        expect(passes).toHaveLength(0);
    });

    it('does not build a pipeline when disposed mid-init', async () => {
        const { device, pipelines } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        const initing = pass.init('bgra8unorm');
        pass.dispose();
        await initing;
        expect(pipelines).toHaveLength(0);
        expect(pass.isReady()).toBe(false);
    });
});

describe('encodeCabinComposite', () => {
    beforeEach(() => {
        mockShaderFetch();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('skips cleanly when there is no pass or no swap-chain view', async () => {
        const { device, encoder, passes } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');
        pass.setSource(sourceFor(fakeTexture('cabin')));

        expect(encodeCabinComposite(encoder, null, () => ({} as GPUTextureView))).toBe(false);
        expect(encodeCabinComposite(encoder, pass, undefined)).toBe(false);
        expect(encodeCabinComposite(encoder, pass, () => null)).toBe(false);
        expect(passes).toHaveLength(0);
    });

    it('swallows a swap-chain failure rather than dropping the road frame', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { device, encoder } = createFakeDevice();
        const pass = new CabinCompositePass(device);
        await pass.init('bgra8unorm');
        pass.setSource(sourceFor(fakeTexture('cabin')));

        expect(encodeCabinComposite(encoder, pass, () => {
            throw new Error('context lost');
        })).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('cabinOverlayRegistry', () => {
    afterEach(() => {
        resetCabinOverlaySourceForTests();
    });

    it('holds one source and can be retracted', () => {
        expect(getCabinOverlaySource()).toBeNull();
        const first = sourceFor(fakeTexture('a'));
        const second = sourceFor(fakeTexture('b'));
        publishCabinOverlaySource(first);
        expect(getCabinOverlaySource()).toBe(first);
        publishCabinOverlaySource(second);
        expect(getCabinOverlaySource()).toBe(second);
        publishCabinOverlaySource(null);
        expect(getCabinOverlaySource()).toBeNull();
    });
});

describe('needsCabinOverlayLatch', () => {
    it('keeps the 2D latch for anything that is not compositing the cabin', () => {
        // No renderer yet, and a renderer too old to answer: assume the latch.
        expect(needsCabinOverlayLatch(null)).toBe(true);
        expect(needsCabinOverlayLatch(undefined)).toBe(true);
        expect(needsCabinOverlayLatch({})).toBe(true);
        // Free-look, or the `?cabin=webgl` hatch.
        expect(needsCabinOverlayLatch({ isCabinCompositedInFrame: () => false })).toBe(true);
    });

    it('drops the latch once the road frame already contains the cabin', () => {
        expect(needsCabinOverlayLatch({ isCabinCompositedInFrame: () => true })).toBe(false);
    });
});
