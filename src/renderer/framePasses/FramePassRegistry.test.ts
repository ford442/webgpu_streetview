// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FramePassRegistry, RequiredPassError, type FrameContext, type FramePass } from './FramePassRegistry';
import { getPassStatuses, resetPassStatuses, type FramePassId } from '../passStatus';
import { GpuValidationError } from '../gpuPipelineFactory';

const frame = {} as FrameContext;

function pass(id: FramePassId, order: number, over: Partial<FramePass> = {}, log: string[] = []): FramePass {
    return {
        id,
        order,
        init: async () => undefined,
        enabled: () => true,
        encode: () => {
            log.push(id);
        },
        destroy: vi.fn(),
        ...over,
    };
}

describe('FramePassRegistry', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        resetPassStatuses();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('encodes in order regardless of registration order', async () => {
        const log: string[] = [];
        const r = new FramePassRegistry();
        r.register(pass('cabin-composite', 400, {}, log));
        r.register(pass('streetview', 100, {}, log));
        r.register(pass('weather', 300, {}, log));
        await r.initAll();
        expect(r.encode({} as GPUCommandEncoder, frame)).toEqual(['streetview', 'weather', 'cabin-composite']);
        expect(log).toEqual(['streetview', 'weather', 'cabin-composite']);
    });

    it('initialises passes concurrently, not one after another', async () => {
        const started: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const r = new FramePassRegistry();
        r.register(pass('streetview', 100, { init: async () => { started.push('streetview'); await gate; } }));
        r.register(pass('weather', 300, { init: async () => { started.push('weather'); await gate; } }));
        const done = r.initAll();
        await Promise.resolve();
        expect(started).toEqual(['streetview', 'weather']);
        release();
        await done;
    });

    it('a failed optional pass is reported with its WGSL diagnostics and never encoded', async () => {
        const log: string[] = [];
        const r = new FramePassRegistry();
        r.register(pass('streetview', 100, {}, log));
        r.register(pass('cabin-composite', 400, {
            init: async () => {
                throw new GpuValidationError('cabin-composite.wgsl', 'unexpected token', [
                    { type: 'error', message: 'unexpected token', lineNum: 3, linePos: 9 },
                ]);
            },
        }, log));
        await r.initAll();

        expect(r.isReady('cabin-composite')).toBe(false);
        expect(getPassStatuses()['cabin-composite']).toEqual({
            state: 'failed',
            reason: '[cabin-composite.wgsl] unexpected token',
            compilation: [{ type: 'error', message: 'unexpected token', lineNum: 3, linePos: 9 }],
        });
        expect(getPassStatuses().streetview).toEqual({ state: 'ready' });
        r.encode({} as GPUCommandEncoder, frame);
        expect(log).toEqual(['streetview']);
    });

    it('a failed required pass rejects once every init has settled', async () => {
        const r = new FramePassRegistry();
        let weatherSettled = false;
        r.register(pass('streetview', 100, { required: true, init: async () => { throw new Error('404'); } }));
        r.register(pass('weather', 300, { init: async () => { await Promise.resolve(); weatherSettled = true; } }));
        const err = await r.initAll().catch((e) => e);
        expect(err).toBeInstanceOf(RequiredPassError);
        expect(err.passId).toBe('streetview');
        expect(weatherSettled).toBe(true);
    });

    it('skips lazy passes in initAll until initPass is called', async () => {
        const init = vi.fn(async () => undefined);
        const r = new FramePassRegistry();
        r.register(pass('present-fallback', 310, { lazy: true, init }));
        await r.initAll();
        expect(init).not.toHaveBeenCalled();
        expect(r.isReady('present-fallback')).toBe(false);
        expect(await r.initPass('present-fallback')).toBe(true);
        expect(getPassStatuses()['present-fallback']).toEqual({ state: 'ready' });
    });

    it('an optional pass that throws while encoding is skipped for the frame, warned once', async () => {
        const log: string[] = [];
        const r = new FramePassRegistry();
        r.register(pass('weather', 300, {}, log));
        r.register(pass('cabin-composite', 400, { encode: () => { throw new Error('lost texture'); } }, log));
        await r.initAll();
        expect(r.encode({} as GPUCommandEncoder, frame)).toEqual(['weather']);
        r.encode({} as GPUCommandEncoder, frame);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('honours enabled() per frame and rejects duplicate ids', async () => {
        let on = false;
        const r = new FramePassRegistry();
        r.register(pass('historical-wipe', 200, { enabled: () => on }));
        await r.initAll();
        expect(r.encode({} as GPUCommandEncoder, frame)).toEqual([]);
        on = true;
        expect(r.encode({} as GPUCommandEncoder, frame)).toEqual(['historical-wipe']);
        expect(() => r.register(pass('historical-wipe', 250))).toThrow(/already registered/);
    });

    it('publishes statuses onto window.webgpuProbe.passes', async () => {
        (window as unknown as { webgpuProbe: object }).webgpuProbe = { ok: true };
        resetPassStatuses();
        const r = new FramePassRegistry();
        r.register(pass('weather', 300, { init: async () => { throw new Error('bad'); } }));
        await r.initAll();
        expect(window.webgpuProbe?.passes?.weather?.state).toBe('failed');
        delete (window as unknown as { webgpuProbe?: object }).webgpuProbe;
    });
});
