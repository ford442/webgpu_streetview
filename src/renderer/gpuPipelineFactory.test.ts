import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createComputePipelineChecked,
    createRenderPipelineChecked,
    createShaderModuleChecked,
    formatDiagnostics,
    GpuValidationError,
    withErrorScope,
} from './gpuPipelineFactory';

/**
 * A device with real error-scope semantics: errors raised while a scope is
 * pushed land in that scope; anything else would be `uncapturederror`.
 */
function scopedDevice(opts: {
    moduleMessages?: Array<{ type: GPUCompilationMessageType; message: string; lineNum: number; linePos: number }>;
    raiseOn?: 'createShaderModule' | 'createRenderPipeline' | 'createComputePipeline';
    asyncReject?: string;
    withAsync?: boolean;
} = {}) {
    const scopes: Array<GPUError | null> = [];
    const uncaptured: string[] = [];
    const raise = (message: string) => {
        if (scopes.length) scopes[scopes.length - 1] = { message } as GPUError;
        else uncaptured.push(message);
    };
    const device = {
        pushErrorScope: vi.fn(() => {
            scopes.push(null);
        }),
        popErrorScope: vi.fn(async () => scopes.pop() ?? null),
        createShaderModule: vi.fn((d: GPUShaderModuleDescriptor) => {
            if (opts.raiseOn === 'createShaderModule') raise('shader module invalid');
            return {
                label: d.label,
                getCompilationInfo: async () => ({ messages: opts.moduleMessages ?? [] }),
            };
        }),
        createRenderPipeline: vi.fn(() => {
            if (opts.raiseOn === 'createRenderPipeline') raise('render pipeline invalid');
            return { kind: 'render' };
        }),
        createComputePipeline: vi.fn(() => {
            if (opts.raiseOn === 'createComputePipeline') raise('compute pipeline invalid');
            return { kind: 'compute' };
        }),
        ...(opts.withAsync
            ? {
                createRenderPipelineAsync: vi.fn(async () => {
                    if (opts.asyncReject) throw new Error(opts.asyncReject);
                    return { kind: 'render-async' };
                }),
                createComputePipelineAsync: vi.fn(async () => {
                    if (opts.asyncReject) throw new Error(opts.asyncReject);
                    return { kind: 'compute-async' };
                }),
            }
            : {}),
    };
    return { device: device as unknown as GPUDevice, raw: device, scopes, uncaptured };
}

const renderDesc = (module: GPUShaderModule) => ({
    label: 'test-pipeline',
    layout: 'auto' as const,
    vertex: { module, entryPoint: 'vs_main' },
});

describe('gpuPipelineFactory', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        errorSpy.mockRestore();
    });

    it('rejects a WGSL error with label:line:col diagnostics instead of returning an invalid module', async () => {
        const { device, scopes, uncaptured } = scopedDevice({
            raiseOn: 'createShaderModule',
            moduleMessages: [
                { type: 'warning', message: 'unused variable', lineNum: 2, linePos: 5 },
                { type: 'error', message: "expected ';'", lineNum: 7, linePos: 12 },
            ],
        });
        const err = await createShaderModuleChecked(device, { label: 'broken.wgsl', code: 'fn' }).catch((e) => e);
        expect(err).toBeInstanceOf(GpuValidationError);
        expect(err.message).toBe("[broken.wgsl] expected ';'");
        expect(err.diagnostics).toHaveLength(2);
        expect(errorSpy.mock.calls[0]![0]).toContain("broken.wgsl:7:12 error: expected ';'");
        // The error was captured by our scope, not reported as uncaptured, and the scope was popped.
        expect(uncaptured).toEqual([]);
        expect(scopes).toEqual([]);
    });

    it('attributes errors correctly when passes compile concurrently (one scope stack per device)', async () => {
        const scopes: Array<GPUError | null> = [];
        const device = {
            pushErrorScope: () => { scopes.push(null); },
            popErrorScope: async () => scopes.pop() ?? null,
            createShaderModule: (d: GPUShaderModuleDescriptor) => {
                if (d.code.includes('bad')) scopes[scopes.length - 1] = { message: `${d.label} invalid` } as GPUError;
                // No diagnostics: only the scope can tell which module failed.
                return { getCompilationInfo: () => new Promise((r) => setTimeout(() => r({ messages: [] }), 0)) };
            },
        } as unknown as GPUDevice;
        const [bad, good] = await Promise.allSettled([
            createShaderModuleChecked(device, { label: 'bad.wgsl', code: 'bad' }),
            createShaderModuleChecked(device, { label: 'good.wgsl', code: 'ok' }),
        ]);
        expect(bad.status).toBe('rejected');
        expect((bad as PromiseRejectedResult).reason.message).toBe('[bad.wgsl] bad.wgsl invalid');
        expect(good.status).toBe('fulfilled');
        expect(scopes).toEqual([]);
    });

    it('returns the module when compilation has only warnings', async () => {
        const { device } = scopedDevice({
            moduleMessages: [{ type: 'warning', message: 'meh', lineNum: 1, linePos: 1 }],
        });
        const module = await createShaderModuleChecked(device, { label: 'ok.wgsl', code: '' });
        expect((module as unknown as { label: string }).label).toBe('ok.wgsl');
    });

    it('prefers create*PipelineAsync and wraps its rejection with the pipeline label', async () => {
        const { device, raw } = scopedDevice({ withAsync: true, asyncReject: 'GPUPipelineError: validation' });
        const err = await createRenderPipelineChecked(device, renderDesc({} as GPUShaderModule)).catch((e) => e);
        expect(err).toBeInstanceOf(GpuValidationError);
        expect(err.message).toBe('[test-pipeline] GPUPipelineError: validation');
        expect(raw.createRenderPipeline).not.toHaveBeenCalled();

        const cerr = await createComputePipelineChecked(device, {
            label: 'probe',
            layout: 'auto',
            compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
        }).catch((e) => e);
        expect(cerr.message).toBe('[probe] GPUPipelineError: validation');
    });

    it('falls back to the sync call inside a validation scope when there is no async entry point', async () => {
        const { device, raw, uncaptured } = scopedDevice({ raiseOn: 'createRenderPipeline' });
        await expect(createRenderPipelineChecked(device, renderDesc({} as GPUShaderModule)))
            .rejects.toThrow('[test-pipeline] render pipeline invalid');
        expect(raw.pushErrorScope).toHaveBeenCalledWith('validation');
        expect(uncaptured).toEqual([]);

        const ok = scopedDevice();
        await expect(createComputePipelineChecked(ok.device, {
            label: 'c',
            layout: 'auto',
            compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
        })).resolves.toEqual({ kind: 'compute' });
    });

    it('withErrorScope always pops its scope, also when the callback throws', async () => {
        const { device, scopes } = scopedDevice();
        await expect(withErrorScope(device, 'out-of-memory', 'buf', () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
        expect(scopes).toEqual([]);
        await expect(withErrorScope(device, 'validation', 'x', () => 42)).resolves.toBe(42);
    });

    it('passes straight through on a device without error scopes (jsdom fakes)', async () => {
        const device = {
            createShaderModule: () => ({ kind: 'module' }),
            createRenderPipeline: () => ({ kind: 'render' }),
        } as unknown as GPUDevice;
        const module = await createShaderModuleChecked(device, { label: 'm', code: '' });
        expect(module).toEqual({ kind: 'module' });
        await expect(createRenderPipelineChecked(device, renderDesc(module))).resolves.toEqual({ kind: 'render' });
    });

    it('formats diagnostics one per line', () => {
        expect(formatDiagnostics('a.wgsl', [
            { type: 'error', message: 'x', lineNum: 1, linePos: 2 },
            { type: 'warning', message: 'y', lineNum: 3, linePos: 4 },
        ])).toBe('a.wgsl:1:2 error: x\na.wgsl:3:4 warning: y');
    });
});
