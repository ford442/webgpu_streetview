/**
 * The `reproject` frame pass (#331): the finished road frame → the swap chain
 * (or a WebXR eye), re-aimed at the latest POV and, in stereo, split into eyes.
 * Maths and modes: `reprojectMath.ts`; shader: `reproject.wgsl`.
 *
 * Owns the **present source** — the texture weather (or the upscale) writes
 * instead of the swap chain whenever the frame has a tail (`frameTail.ts`) —
 * at the swap chain's size and format, so the weather pipelines need no
 * variant. With no tail (no `?latelatch`, no `?stereo`, no XR) the pass is
 * never encoded and holds no texture: the frame is the pre-#331 frame.
 *
 * Uniforms live in 256-byte slots of one buffer (dynamic offset), because a
 * WebXR frame encodes both eyes into one submit and a `writeBuffer` between
 * two passes of the same submit would leave both reading the last write.
 */
import {
    createRenderPipelineChecked,
    createShaderModuleChecked,
    fetchShaderSource,
} from '../gpuPipelineFactory';
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';
import { getSceneDepthBindGroupLayout } from '../depth/sceneDepthBinding';
import { REPROJECT_UNIFORM_FLOAT_COUNT } from './reprojectMath';

export const REPROJECT_SHADER_PATH = 'shaders/reproject.wgsl';
/** `minUniformBufferOffsetAlignment`'s ceiling — every adapter accepts it. */
const SLOT_BYTES = 256;
/** Main frame + two eyes + one spare. */
export const REPROJECT_UNIFORM_SLOTS = 4;

export interface ReprojectViewport {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface SizedTexture {
    texture: GPUTexture;
    view: GPUTextureView;
    width: number;
    height: number;
}

export class ReprojectPass {
    private module: GPUShaderModule | null = null;
    private pipelineLayout: GPUPipelineLayout | null = null;
    private layout: GPUBindGroupLayout | null = null;
    private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
    private sampler: GPUSampler | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private presentationFormat: GPUTextureFormat | null = null;

    private source: SizedTexture | null = null;
    /** Keyed by the texture it binds — the source, or an XR frame's road texture. */
    private bindGroup: { texture: GPUTexture; group: GPUBindGroup } | null = null;
    private disposed = false;

    constructor(private readonly device: GPUDevice) {}

    public async init(presentationFormat: GPUTextureFormat): Promise<void> {
        const url = `${process.env.PUBLIC_URL || '/'}/${REPROJECT_SHADER_PATH}`;
        const code = await fetchShaderSource(url, 'reproject.wgsl');
        if (this.disposed) return;
        this.module = await createShaderModuleChecked(this.device, { label: 'reproject.wgsl', code });
        const layout = this.device.createBindGroupLayout({
            label: 'reproject-bind-group-layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: REPROJECT_UNIFORM_FLOAT_COUNT * 4 },
                },
            ],
        });
        this.pipelineLayout = this.device.createPipelineLayout({
            label: 'reproject-pipeline-layout',
            bindGroupLayouts: [layout, getSceneDepthBindGroupLayout(this.device)],
        });
        await this.ensureFormat(presentationFormat);
        if (this.disposed) return;
        this.sampler = this.device.createSampler({
            label: 'reproject-sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this.uniformBuffer = createTrackedBuffer(this.device, {
            label: 'reproject-uniforms',
            size: SLOT_BYTES * REPROJECT_UNIFORM_SLOTS,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }, 'reproject-uniforms');
        this.presentationFormat = presentationFormat;
        // Last: `isReady()` turns true only for a pipeline that passed validation.
        this.layout = layout;
    }

    /**
     * Build the pipeline for another target format — a WebXR projection layer
     * is `rgba8unorm`/`bgra8unorm` whatever the canvas is. Rejects on a
     * validation error, like every pipeline here.
     */
    public async ensureFormat(format: GPUTextureFormat): Promise<void> {
        if (this.pipelines.has(format) || !this.module || !this.pipelineLayout) return;
        const pipeline = await createRenderPipelineChecked(this.device, {
            label: `reproject-pipeline-${format}`,
            layout: this.pipelineLayout,
            vertex: { module: this.module, entryPoint: 'vs_main' },
            fragment: { module: this.module, entryPoint: 'fs_main', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        });
        if (!this.disposed) this.pipelines.set(format, pipeline);
    }

    public isReady(): boolean {
        return !this.disposed && this.layout !== null;
    }

    public hasFormat(format: GPUTextureFormat): boolean {
        return this.pipelines.has(format);
    }

    /**
     * The present source for this frame — what weather / the upscale draw into
     * instead of the swap chain. Swap-chain size and format; recreated when the
     * size changes; undefined before `init` has succeeded.
     */
    public ensureSource(width: number, height: number): GPUTextureView | undefined {
        if (!this.isReady() || !this.presentationFormat) return undefined;
        if (this.source?.width !== width || this.source?.height !== height) {
            destroyTracked(this.source?.texture);
            const texture = createTrackedTexture(this.device, {
                label: 'reproject-source',
                size: [width, height],
                format: this.presentationFormat,
                // COPY_DST: a WebXR frame or a test can fill it without a draw.
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            }, 'reproject-source');
            this.source = { texture, view: texture.createView(), width, height };
        }
        return this.source.view;
    }

    public getSourceTexture(): GPUTexture | null {
        return this.source?.texture ?? null;
    }

    /** Upload one slot's uniforms. Call before encoding the pass that reads that slot. */
    public writeUniforms(slot: number, uniforms: Float32Array<ArrayBuffer>): void {
        if (!this.uniformBuffer) return;
        this.device.queue.writeBuffer(this.uniformBuffer, slot * SLOT_BYTES, uniforms);
    }

    /**
     * Draw the source into `outputView`. `viewport` confines it to a sub-rect
     * (a WebXR view); `format` must have a pipeline (`ensureFormat`). False —
     * nothing encoded — before `init`, or before there is a source.
     */
    public encode(
        encoder: GPUCommandEncoder,
        outputView: GPUTextureView,
        depthBindGroup: GPUBindGroup,
        options: { slot?: number; format?: GPUTextureFormat; viewport?: ReprojectViewport; clear?: boolean } = {},
    ): boolean {
        const source = this.source;
        const pipeline = this.pipelines.get(options.format ?? this.presentationFormat!);
        if (!this.isReady() || !source || !pipeline) return false;
        if (this.bindGroup?.texture !== source.texture) {
            this.bindGroup = {
                texture: source.texture,
                group: this.device.createBindGroup({
                    label: 'reproject-bind-group',
                    layout: this.layout!,
                    entries: [
                        { binding: 0, resource: source.view },
                        { binding: 1, resource: this.sampler! },
                        { binding: 2, resource: { buffer: this.uniformBuffer!, size: REPROJECT_UNIFORM_FLOAT_COUNT * 4 } },
                    ],
                }),
            };
        }
        const pass = encoder.beginRenderPass({
            label: 'reproject',
            colorAttachments: [{
                view: outputView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: (options.clear === false ? 'load' : 'clear') as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        });
        const vp = options.viewport;
        if (vp) pass.setViewport(vp.x, vp.y, vp.width, vp.height, 0, 1);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.bindGroup.group, [(options.slot ?? 0) * SLOT_BYTES]);
        pass.setBindGroup(1, depthBindGroup);
        pass.draw(3, 1, 0, 0);
        pass.end();
        return true;
    }

    public dispose(): void {
        this.disposed = true;
        destroyTracked(this.source?.texture);
        destroyTracked(this.uniformBuffer);
        this.source = null;
        this.bindGroup = null;
        this.uniformBuffer = null;
        this.layout = null;
        this.pipelineLayout = null;
        this.module = null;
        this.pipelines.clear();
        this.sampler = null;
    }
}
