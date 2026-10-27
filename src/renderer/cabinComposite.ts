/**
 * The one-frame compositor's third pass: cabin over road, same encoder, same
 * swap chain.
 *
 * Before this, car mode was a **second canvas** — a `WebGPURenderer` with
 * `alpha: true` stacked over the weather-post canvas in CSS. That made the
 * composited still something only the page ever saw: cinema and snapshots had
 * to re-composite the two canvases in 2D through `car/runtime/frameCapture.ts`,
 * and the road frame could never be a source the cabin reads.
 *
 * Now the cabin renders into a `GPUTexture` on the **same** `GPUDevice` (see
 * `car/interior/cabinFrameTarget.ts`) and this pass draws it over the swap
 * chain right after the weather pass, inside `frameLoop.encodeAndSubmitFrame`.
 * Nothing else changes: still one `requestDevice`, still one
 * `configureCanvasContext`, and with no cabin registered the pass is not
 * encoded at all, so a free-look frame is byte-identical to before.
 *
 * ### Blending
 *
 * The cabin target is cleared to transparent black and drawn with three's
 * `NormalBlending`, which leaves **premultiplied** texels. So does a
 * `premultiplied` canvas, which is what the browser used to composite. Keeping
 * premultiplied source-over here means the composited pixel matches what CSS
 * produced, rather than being a new look.
 *
 * ### Ordering
 *
 * The cabin runs on its own `requestAnimationFrame` (the car runtime's), so the
 * texture this pass samples is simply the most recent cabin frame — the same
 * ≤1-frame relationship the browser's CSS composite had. WebGPU serializes
 * queue submissions, so there is no read/write hazard either way; at worst the
 * frame shows the previous cabin draw.
 */

/**
 * What the car runtime publishes for the renderer to composite.
 *
 * `getTexture()` is called once per frame and may return a **different**
 * texture each time — three reallocates the render target's GPU texture on
 * resize — so the pass re-binds whenever the identity changes rather than
 * caching a view forever. Returning `null` (car mode off, the WebGL cabin
 * hatch, or a target that has not drawn yet) skips the pass entirely.
 */
export interface CabinOverlaySource {
    getTexture(): GPUTexture | null;
    /**
     * How the texture is laid out (#331): one view, or two eyes side by side
     * (`renderer/cabinStereoRequest.ts`). Absent means `mono`.
     */
    getLayout?(): CabinOverlayLayout;
}

export type CabinOverlayLayout = 'mono' | 'sbs';

/** The part of the renderer that capture needs, without importing the whole surface. */
export interface CabinCompositeAwareRenderer {
    isCabinCompositedInFrame?: () => boolean;
}

/**
 * Whether cinema / snapshots still have to composite the cabin canvas
 * themselves through the 2D latch (`car/runtime/frameCapture.ts`).
 *
 * False exactly when this renderer already drew the cabin into the frame it
 * presents. Anything else — free-look, the `?cabin=webgl` hatch, a renderer
 * too old to answer — keeps the latch, which is the behaviour that predates
 * the one-frame compositor.
 */
export function needsCabinOverlayLatch(
    renderer: CabinCompositeAwareRenderer | null | undefined,
): boolean {
    return renderer?.isCabinCompositedInFrame?.() !== true;
}

/** Premultiplied source-over — see the module doc. */
export const CABIN_COMPOSITE_BLEND: GPUBlendState = {
    color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};

import {
    createRenderPipelineChecked,
    createShaderModuleChecked,
    fetchShaderSource,
} from './gpuPipelineFactory';
import { createTrackedBuffer, destroyTracked } from './gpuMemoryTracking';

export const CABIN_COMPOSITE_SHADER_PATH = 'shaders/cabin-composite.wgsl';

export async function loadCabinCompositeShader(): Promise<string> {
    const url = `${process.env.PUBLIC_URL || '/'}/${CABIN_COMPOSITE_SHADER_PATH}`;
    return fetchShaderSource(url, 'cabin-composite.wgsl');
}

/** A sub-rect of the target (one eye of a side-by-side frame). */
export interface CabinCompositeViewport {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Which part of the cabin texture a draw samples (#331): all of it, or one eye
 * of a side-by-side stereo cabin.
 */
export type CabinCompositeRegion = 'full' | 'left' | 'right';

/** `CabinRect` in the WGSL: offset.xy, scale.xy. */
const REGION_RECTS: Record<CabinCompositeRegion, readonly number[]> = {
    full: [0, 0, 1, 1],
    left: [0, 0, 0.5, 1],
    right: [0.5, 0, 0.5, 1],
};

export class CabinCompositePass {
    private pipeline: GPURenderPipeline | null = null;
    /** The swap chain's format, and pipelines for other targets (a WebXR layer, #331). */
    private presentationFormat: GPUTextureFormat | null = null;
    private readonly formatPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
    private readonly pendingFormats = new Map<GPUTextureFormat, Promise<void>>();
    private module: GPUShaderModule | null = null;
    private layout: GPUBindGroupLayout | null = null;
    private sampler: GPUSampler | null = null;
    private source: CabinOverlaySource | null = null;
    /** One constant 16-byte rect per region, written once at init. */
    private rects: Partial<Record<CabinCompositeRegion, GPUBuffer>> = {};

    /** Cached per texture identity — rebuilt when three reallocates the target. */
    private boundTexture: GPUTexture | null = null;
    private bindGroups: Partial<Record<CabinCompositeRegion, GPUBindGroup>> = {};

    private disposed = false;

    constructor(private readonly device: GPUDevice) {}

    /**
     * Build the pipeline. A failure here is never fatal: the pass stays
     * inactive and the cabin falls back to the CSS overlay + 2D latch, which is
     * why `Renderer.init` only logs the rejection.
     */
    public async init(presentationFormat: GPUTextureFormat): Promise<void> {
        const code = await loadCabinCompositeShader();
        if (this.disposed) return;
        const module = await createShaderModuleChecked(this.device, {
            label: 'cabin-composite.wgsl',
            code,
        });
        // An explicit layout so one bind group serves every format's pipeline.
        const layout = this.device.createBindGroupLayout({
            label: 'cabin-composite-bind-group-layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 16 } },
            ],
        });
        this.module = module;
        this.layout = layout;
        const pipeline = await this.createPipeline(presentationFormat);
        if (this.disposed) return;
        this.sampler = this.device.createSampler({
            label: 'cabin-composite-sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        for (const region of Object.keys(REGION_RECTS) as CabinCompositeRegion[]) {
            const buffer = createTrackedBuffer(this.device, {
                label: `cabin-composite-rect-${region}`,
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }, `cabin-composite-rect-${region}`);
            this.device.queue.writeBuffer(buffer, 0, new Float32Array(REGION_RECTS[region]));
            this.rects[region] = buffer;
        }
        // Assigned last: `isReady()` (and so `isCabinCompositedInFrame()`) can
        // only turn true for a pipeline that passed validation.
        this.presentationFormat = presentationFormat;
        this.pipeline = pipeline;
    }

    private createPipeline(format: GPUTextureFormat): Promise<GPURenderPipeline> {
        return createRenderPipelineChecked(this.device, {
            label: format === this.presentationFormat || this.presentationFormat === null
                ? 'cabin-composite-pipeline'
                : `cabin-composite-pipeline-${format}`,
            layout: this.device.createPipelineLayout({
                label: 'cabin-composite-pipeline-layout',
                bindGroupLayouts: [this.layout!],
            }),
            vertex: { module: this.module!, entryPoint: 'vs_main' },
            fragment: {
                module: this.module!,
                entryPoint: 'fs_main',
                targets: [{ format, blend: CABIN_COMPOSITE_BLEND }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    /**
     * Build the pipeline for another target format (a WebXR projection layer
     * may not share the swap chain's). Resolves once it can be drawn with;
     * rejects (and stays unavailable) when it fails validation.
     */
    public ensureFormat(format: GPUTextureFormat): Promise<void> {
        if (!this.isReady()) return Promise.reject(new Error('cabin composite is not ready'));
        if (format === this.presentationFormat || this.formatPipelines.has(format)) return Promise.resolve();
        let pending = this.pendingFormats.get(format);
        if (!pending) {
            pending = this.createPipeline(format).then((pipeline) => {
                if (!this.disposed) this.formatPipelines.set(format, pipeline);
            });
            this.pendingFormats.set(format, pending);
        }
        return pending;
    }

    public hasFormat(format: GPUTextureFormat): boolean {
        return this.isReady() && (format === this.presentationFormat || this.formatPipelines.has(format));
    }

    public isReady(): boolean {
        return !this.disposed && this.pipeline !== null;
    }

    public setSource(source: CabinOverlaySource | null): void {
        if (this.source === source) return;
        this.source = source;
        this.boundTexture = null;
        this.bindGroups = {};
    }

    /** The source's layout this frame (`mono` when it does not say). */
    public getLayout(): CabinOverlayLayout {
        try {
            return this.source?.getLayout?.() ?? 'mono';
        } catch {
            return 'mono';
        }
    }

    public getSource(): CabinOverlaySource | null {
        return this.source;
    }

    /**
     * True when this frame will actually draw a cabin over the road — the
     * pipeline built, a source is registered, and it has a texture right now.
     * Cinema and snapshots read this to decide whether the 2D latch is still
     * needed, so it must reflect the current frame, not intent.
     */
    public isActive(): boolean {
        return this.isReady() && this.resolveTexture() !== null;
    }

    private resolveTexture(): GPUTexture | null {
        if (!this.source) return null;
        try {
            return this.source.getTexture();
        } catch {
            // A cabin that throws while handing over its texture must not take
            // the road frame down with it — composite nothing this frame.
            return null;
        }
    }

    /**
     * Encode the composite over `targetView`, which must be the swap-chain view
     * the weather pass just wrote — this loads it rather than clearing.
     * No-op when there is nothing to draw.
     */
    public encode(
        commandEncoder: GPUCommandEncoder,
        targetView: GPUTextureView,
        viewport?: CabinCompositeViewport,
        region: CabinCompositeRegion = 'full',
        format?: GPUTextureFormat,
    ): boolean {
        if (!this.isReady()) return false;
        const pipeline = format && format !== this.presentationFormat ? this.formatPipelines.get(format) : this.pipeline;
        if (!pipeline) return false;
        const texture = this.resolveTexture();
        if (!texture) return false;

        if (this.boundTexture !== texture) {
            this.bindGroups = {};
            this.boundTexture = texture;
        }
        const bindGroup = this.bindGroups[region] ??= this.device.createBindGroup({
            label: `cabin-composite-bind-group-${region}`,
            layout: this.layout!,
            entries: [
                { binding: 0, resource: texture.createView() },
                { binding: 1, resource: this.sampler! },
                { binding: 2, resource: { buffer: this.rects[region]! } },
            ],
        });

        const pass = commandEncoder.beginRenderPass({
            label: 'cabin-composite',
            colorAttachments: [{
                view: targetView,
                loadOp: 'load' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        });
        if (viewport) pass.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3, 1, 0, 0);
        pass.end();
        return true;
    }

    public dispose(): void {
        this.disposed = true;
        for (const buffer of Object.values(this.rects)) destroyTracked(buffer);
        this.rects = {};
        this.pipeline = null;
        this.formatPipelines.clear();
        this.pendingFormats.clear();
        this.module = null;
        this.layout = null;
        this.sampler = null;
        this.source = null;
        this.boundTexture = null;
        this.bindGroups = {};
    }
}
