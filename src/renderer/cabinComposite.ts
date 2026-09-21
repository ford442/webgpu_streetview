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
}

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

export const CABIN_COMPOSITE_SHADER_PATH = 'shaders/cabin-composite.wgsl';

export async function loadCabinCompositeShader(): Promise<string> {
    const url = `${process.env.PUBLIC_URL || '/'}/${CABIN_COMPOSITE_SHADER_PATH}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Failed to load cabin-composite.wgsl: ${response.status} ${response.statusText}`,
        );
    }
    return response.text();
}

export class CabinCompositePass {
    private pipeline: GPURenderPipeline | null = null;
    private sampler: GPUSampler | null = null;
    private source: CabinOverlaySource | null = null;

    /** Cached per texture identity — rebuilt when three reallocates the target. */
    private boundTexture: GPUTexture | null = null;
    private bindGroup: GPUBindGroup | null = null;

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
        const module = this.device.createShaderModule({ code });
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module, entryPoint: 'vs_main' },
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{ format: presentationFormat, blend: CABIN_COMPOSITE_BLEND }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    public isReady(): boolean {
        return !this.disposed && this.pipeline !== null;
    }

    public setSource(source: CabinOverlaySource | null): void {
        if (this.source === source) return;
        this.source = source;
        this.boundTexture = null;
        this.bindGroup = null;
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
    public encode(commandEncoder: GPUCommandEncoder, targetView: GPUTextureView): boolean {
        if (!this.isReady()) return false;
        const texture = this.resolveTexture();
        if (!texture) return false;

        if (this.boundTexture !== texture || !this.bindGroup) {
            this.bindGroup = this.device.createBindGroup({
                layout: this.pipeline!.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: texture.createView() },
                    { binding: 1, resource: this.sampler! },
                ],
            });
            this.boundTexture = texture;
        }

        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                loadOp: 'load' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        });
        pass.setPipeline(this.pipeline!);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(3, 1, 0, 0);
        pass.end();
        return true;
    }

    public dispose(): void {
        this.disposed = true;
        this.pipeline = null;
        this.sampler = null;
        this.source = null;
        this.boundTexture = null;
        this.bindGroup = null;
    }
}
