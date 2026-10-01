/**
 * Minimal recording fake of the WebGPU surface the compute weather path uses.
 *
 * jsdom has no `navigator.gpu`, so the compute weather post-processor has
 * historically had **no** runtime coverage at all — the "weather parity" test
 * only diffs `.wgsl` text, and the contract test only checks that method names
 * exist on the prototype. That left bind-group wiring, ping-pong ordering and
 * resource lifecycle verifiable only by running it on real hardware.
 *
 * This fake records every call so those things can be asserted as ordinary
 * unit tests. It is deliberately dumb: it validates nothing, it just remembers
 * what it was asked to do, and hands back labelled objects so assertions can
 * say *which* texture landed on *which* binding.
 */

export interface FakeTexture {
    kind: 'texture';
    id: number;
    label: string;
    descriptor: GPUTextureDescriptor;
    destroyed: boolean;
    createView: () => FakeTextureView;
    destroy: () => void;
}

export interface FakeTextureView {
    kind: 'view';
    /** The texture this view was taken from — how tests identify a binding. */
    texture: FakeTexture;
}

export interface FakeBuffer {
    kind: 'buffer';
    id: number;
    descriptor: GPUBufferDescriptor;
    destroyed: boolean;
    /** Spec `GPUBuffer.mapState`; a submit that touches a non-unmapped buffer is an error. */
    mapState: GPUBufferMapState;
    mapAsync: (mode: number) => Promise<void>;
    getMappedRange: () => ArrayBuffer;
    unmap: () => void;
    destroy: () => void;
}

export interface RecordedPass {
    type: 'compute' | 'render';
    pipeline: unknown;
    bindGroups: Array<{ index: number; group: unknown }>;
    dispatches: Array<[number, number]>;
    draws: number[];
    ended: boolean;
    /**
     * `timestampWrites` as handed to `beginRenderPass` / `beginComputePass` —
     * the modern timing path, which is what tests assert on.
     */
    timestampWrites?: {
        querySet: unknown;
        beginningOfPassWriteIndex?: number;
        endOfPassWriteIndex?: number;
    } | undefined;
    /**
     * Legacy in-pass `writeTimestamp` calls. Should stay empty on any device
     * that takes the pass-descriptor path.
     */
    writeTimestampCalls: Array<{ querySet: unknown; index: number }>;
}

export interface RecordedBindGroup {
    kind: 'bindGroup';
    id: number;
    descriptor: GPUBindGroupDescriptor;
    /** Flattened `binding -> resource` for readable assertions. */
    entries: Map<number, unknown>;
}

export interface RecordedEncoder {
    passes: RecordedPass[];
    copies: Array<{ src: unknown; dst: unknown; size: unknown }>;
    querySetResolves: Array<{ querySet: unknown; firstQuery: number; queryCount: number }>;
    /** `copyBufferToBuffer` calls, with the destination's map state at record time. */
    bufferCopies: Array<{ src: FakeBuffer; dst: FakeBuffer; size: number; dstMapState: GPUBufferMapState }>;
}

/** A created query set, so timing tests can identify which one a pass named. */
export interface RecordedQuerySet {
    kind: 'querySet';
    id: number;
    descriptor: GPUQuerySetDescriptor;
    destroyed: boolean;
    destroy: () => void;
}

export interface FakeGpuOptions {
    /**
     * Device features `device.features.has` reports. Default: none, matching
     * the historical fake (SwiftShader-ish, no timestamps).
     */
    features?: string[];
    /**
     * Make `beginComputePass`/`beginRenderPass` throw when handed a
     * `timestampWrites` descriptor — the stand-in for an implementation that
     * only supports `timestamp-query-inside-passes`.
     */
    rejectPassDescriptorTimestampWrites?: boolean;
    /**
     * Hold every `mapAsync` pending until the test calls `gpu.settleMaps()`,
     * so a readback can be observed mid-flight. Default: maps resolve at once.
     */
    manualMaps?: boolean;
}

/** A created bind group *layout*, so tests can assert declared sample types. */
export interface RecordedBindGroupLayout {
    kind: 'bgl';
    id: number;
    entries: Array<{
        binding: number;
        texture?: { sampleType?: string };
        sampler?: { type?: string };
        storageTexture?: { access?: string; format?: string };
        buffer?: { type?: string };
    }>;
}

export interface FakeGpu {
    device: GPUDevice;
    context: GPUCanvasContext;
    canvas: HTMLCanvasElement;
    textures: FakeTexture[];
    buffers: FakeBuffer[];
    bindGroups: RecordedBindGroup[];
    bindGroupLayouts: RecordedBindGroupLayout[];
    encoders: RecordedEncoder[];
    querySets: RecordedQuerySet[];
    computePipelines: Array<{ id: number; entryPoint: string }>;
    renderPipelines: Array<{ id: number }>;
    writeBufferCalls: Array<{ buffer: FakeBuffer; data: ArrayBufferView }>;
    writeTextureCalls: Array<{ texture: FakeTexture; size: unknown }>;
    submits: number;
    /**
     * Validation errors a real device would raise on submit — currently a
     * buffer copied into while its map is pending or active.
     */
    submitErrors: string[];
    /** Resolve (or reject) every pending `mapAsync` when `manualMaps` is set. */
    settleMaps: (ok?: boolean) => void;
    /** All passes across all encoders, in creation order. */
    allPasses: () => RecordedPass[];
    /** The single most recently created encoder. */
    lastEncoder: () => RecordedEncoder;
    createCommandEncoder: () => GPUCommandEncoder;
}

/**
 * Install the WebGPU enum globals jsdom lacks. Values mirror the spec so a
 * usage flag read back off a recorded descriptor means what it says.
 */
export function installGpuGlobals(): void {
    const g = globalThis as Record<string, unknown>;
    g.GPUBufferUsage = {
        MAP_READ: 0x0001, MAP_WRITE: 0x0002, COPY_SRC: 0x0004, COPY_DST: 0x0008,
        INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040, STORAGE: 0x0080,
        INDIRECT: 0x0100, QUERY_RESOLVE: 0x0200,
    };
    g.GPUTextureUsage = {
        COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04,
        STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10,
    };
    g.GPUShaderStage = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 };
    g.GPUMapMode = { READ: 0x1, WRITE: 0x2 };
}

/**
 * Stub `fetch` so shader loads resolve. Returns non-empty WGSL-ish text; the
 * fake never compiles it.
 */
export function installShaderFetch(options: { particles?: boolean } = {}): void {
    const withParticles = options.particles !== false;
    (globalThis as Record<string, unknown>).fetch = async (url: string) => {
        const isParticles = String(url).includes('weather-particles');
        if (isParticles && !withParticles) {
            return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
        }
        return { ok: true, status: 200, statusText: 'OK', text: async () => '// fake wgsl' };
    };
}

export function createFakeGpu(options: FakeGpuOptions = {}): FakeGpu {
    let nextId = 1;
    const features = new Set(options.features ?? []);

    const textures: FakeTexture[] = [];
    const buffers: FakeBuffer[] = [];
    const bindGroups: RecordedBindGroup[] = [];
    const bindGroupLayouts: RecordedBindGroupLayout[] = [];
    const encoders: RecordedEncoder[] = [];
    const querySets: RecordedQuerySet[] = [];
    const computePipelines: Array<{ id: number; entryPoint: string }> = [];
    const renderPipelines: Array<{ id: number }> = [];
    const writeBufferCalls: Array<{ buffer: FakeBuffer; data: ArrayBufferView }> = [];
    const writeTextureCalls: Array<{ texture: FakeTexture; size: unknown }> = [];
    const state = { submits: 0 };
    const submitErrors: string[] = [];
    const pendingMaps: Array<{ buf: FakeBuffer; resolve: () => void; reject: (e: Error) => void }> = [];

    function makeTexture(descriptor: GPUTextureDescriptor, label: string): FakeTexture {
        const tex: FakeTexture = {
            kind: 'texture',
            id: nextId++,
            label,
            descriptor,
            destroyed: false,
            createView: () => ({ kind: 'view', texture: tex }),
            destroy: () => { tex.destroyed = true; },
        };
        textures.push(tex);
        return tex;
    }

    /**
     * One object is both the recording and the pass API, so a `setPipeline`
     * call made through the encoder is visible on the object tests inspect.
     */
    function makePass(
        type: 'compute' | 'render',
        descriptor?: { timestampWrites?: RecordedPass['timestampWrites'] },
    ): RecordedPass {
        if (options.rejectPassDescriptorTimestampWrites && descriptor?.timestampWrites) {
            throw new TypeError('timestampWrites is not supported on this pass descriptor');
        }
        const pass: RecordedPass = {
            type,
            pipeline: null,
            bindGroups: [],
            dispatches: [],
            draws: [],
            ended: false,
            timestampWrites: descriptor?.timestampWrites,
            writeTimestampCalls: [],
        };
        return Object.assign(pass, {
            setPipeline: (p: unknown) => { pass.pipeline = p; },
            setBindGroup: (index: number, group: unknown) => { pass.bindGroups.push({ index, group }); },
            dispatchWorkgroups: (x: number, y: number) => { pass.dispatches.push([x, y]); },
            draw: (n: number) => { pass.draws.push(n); },
            end: () => { pass.ended = true; },
            writeTimestamp: (querySet: unknown, index: number) => {
                pass.writeTimestampCalls.push({ querySet, index });
            },
        });
    }

    function createCommandEncoder(): GPUCommandEncoder {
        const rec: RecordedEncoder = { passes: [], copies: [], querySetResolves: [], bufferCopies: [] };
        encoders.push(rec);
        return {
            beginComputePass: (d?: { timestampWrites?: RecordedPass['timestampWrites'] }) => {
                const p = makePass('compute', d);
                rec.passes.push(p);
                return p;
            },
            beginRenderPass: (d?: { timestampWrites?: RecordedPass['timestampWrites'] }) => {
                const p = makePass('render', d);
                rec.passes.push(p);
                return p;
            },
            copyTextureToTexture: (src: unknown, dst: unknown, size: unknown) => {
                rec.copies.push({ src, dst, size });
            },
            copyBufferToBuffer: (src: FakeBuffer, _so: number, dst: FakeBuffer, _do: number, size: number) => {
                rec.bufferCopies.push({ src, dst, size, dstMapState: dst.mapState });
            },
            resolveQuerySet: (querySet: unknown, firstQuery: number, queryCount: number) => {
                rec.querySetResolves.push({ querySet, firstQuery, queryCount });
            },
            finish: () => ({ kind: 'commandBuffer', rec }),
        } as unknown as GPUCommandEncoder;
    }

    const device = {
        features: { has: (name: string) => features.has(name) },
        createQuerySet: (d: GPUQuerySetDescriptor) => {
            const qs: RecordedQuerySet = {
                kind: 'querySet', id: nextId++, descriptor: d, destroyed: false,
                destroy: () => { qs.destroyed = true; },
            };
            querySets.push(qs);
            return qs;
        },
        createSampler: (d?: GPUSamplerDescriptor) => ({ kind: 'sampler', id: nextId++, descriptor: d }),
        createBuffer: (d: GPUBufferDescriptor) => {
            const buf: FakeBuffer = {
                kind: 'buffer', id: nextId++, descriptor: d, destroyed: false,
                mapState: 'unmapped',
                mapAsync: () => {
                    if (buf.mapState !== 'unmapped') {
                        return Promise.reject(new Error('OperationError: buffer already mapped'));
                    }
                    buf.mapState = 'pending';
                    return new Promise<void>((resolve, reject) => {
                        const entry = {
                            buf,
                            resolve: () => { buf.mapState = 'mapped'; resolve(); },
                            reject: (e: Error) => { buf.mapState = 'unmapped'; reject(e); },
                        };
                        if (options.manualMaps) pendingMaps.push(entry);
                        else entry.resolve();
                    });
                },
                getMappedRange: () => {
                    if (buf.mapState !== 'mapped') throw new Error('OperationError: buffer not mapped');
                    return new ArrayBuffer(d.size);
                },
                unmap: () => {
                    const i = pendingMaps.findIndex((m) => m.buf === buf);
                    if (i >= 0) pendingMaps.splice(i, 1)[0]!.reject(new Error('AbortError: unmapped'));
                    buf.mapState = 'unmapped';
                },
                destroy: () => { buf.unmap(); buf.destroyed = true; },
            };
            buffers.push(buf);
            return buf;
        },
        createTexture: (d: GPUTextureDescriptor) => makeTexture(d, `tex${nextId}`),
        createShaderModule: (d: GPUShaderModuleDescriptor) => ({ kind: 'module', id: nextId++, code: d.code }),
        createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => {
            const bgl = {
                kind: 'bgl' as const,
                id: nextId++,
                entries: [...(d.entries as unknown as RecordedBindGroupLayout['entries'])],
            };
            bindGroupLayouts.push(bgl);
            return bgl;
        },
        createPipelineLayout: (d: GPUPipelineLayoutDescriptor) => ({ kind: 'pl', id: nextId++, descriptor: d }),
        createComputePipeline: (d: GPUComputePipelineDescriptor) => {
            const entryPoint = d.compute?.entryPoint ?? '';
            const p = { kind: 'computePipeline', id: nextId++, entryPoint, getBindGroupLayout: (i: number) => ({ kind: 'bgl', group: i }) };
            computePipelines.push({ id: p.id, entryPoint });
            return p;
        },
        createRenderPipeline: (_d: GPURenderPipelineDescriptor) => {
            const p = { kind: 'renderPipeline', id: nextId++, getBindGroupLayout: (i: number) => ({ kind: 'bgl', group: i }) };
            renderPipelines.push({ id: p.id });
            return p;
        },
        createBindGroup: (d: GPUBindGroupDescriptor) => {
            const entries = new Map<number, unknown>();
            for (const e of d.entries as unknown as Array<{ binding: number; resource: unknown }>) {
                entries.set(e.binding, e.resource);
            }
            const bg: RecordedBindGroup = { kind: 'bindGroup', id: nextId++, descriptor: d, entries };
            bindGroups.push(bg);
            return bg;
        },
        createCommandEncoder,
        queue: {
            writeBuffer: (buffer: FakeBuffer, _offset: number, data: ArrayBufferView) => {
                writeBufferCalls.push({ buffer, data });
            },
            writeTexture: (dst: { texture: FakeTexture }, _data: unknown, _layout: unknown, size: unknown) => {
                writeTextureCalls.push({ texture: dst.texture, size });
            },
            submit: (cmds: Array<{ rec?: RecordedEncoder }>) => {
                state.submits += 1;
                for (const cmd of cmds ?? []) {
                    for (const c of cmd.rec?.bufferCopies ?? []) {
                        if (c.dst.mapState !== 'unmapped') {
                            submitErrors.push(
                                `[Buffer "${c.dst.descriptor.label ?? '(unlabeled)'}"] used in submit while mapped`,
                            );
                        }
                    }
                }
            },
            onSubmittedWorkDone: async () => {},
        },
    } as unknown as GPUDevice;

    const canvasTexture = makeTexture(
        { size: [8, 8], format: 'bgra8unorm', usage: 0 } as GPUTextureDescriptor,
        'canvas',
    );
    const context = {
        getCurrentTexture: () => canvasTexture,
        configure: () => {},
        unconfigure: () => {},
    } as unknown as GPUCanvasContext;

    return {
        device,
        context,
        canvas: { width: 8, height: 8 } as HTMLCanvasElement,
        textures,
        buffers,
        bindGroups,
        bindGroupLayouts,
        encoders,
        querySets,
        computePipelines,
        renderPipelines,
        writeBufferCalls,
        writeTextureCalls,
        get submits() { return state.submits; },
        submitErrors,
        settleMaps: (ok = true) => {
            for (const m of pendingMaps.splice(0)) {
                if (ok) m.resolve();
                else m.reject(new Error('OperationError: map failed'));
            }
        },
        allPasses: () => encoders.flatMap((e) => e.passes),
        lastEncoder: () => encoders[encoders.length - 1]!,
        createCommandEncoder,
    } as FakeGpu;
}

/** Resolve a recorded binding back to the texture it came from, if it is a view. */
export function bindingTexture(resource: unknown): FakeTexture | null {
    const v = resource as FakeTextureView | undefined;
    return v && v.kind === 'view' ? v.texture : null;
}

/** Resolve a recorded binding back to the buffer it came from, if it is one. */
export function bindingBuffer(resource: unknown): FakeBuffer | null {
    const b = resource as { buffer?: FakeBuffer } | undefined;
    return b && b.buffer ? b.buffer : null;
}
