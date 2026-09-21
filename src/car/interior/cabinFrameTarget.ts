import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { CabinOverlaySource } from '../../renderer/cabinComposite';
import { isWebGPUCabinRenderer, type CabinRenderer } from './createCabinRenderer';

/**
 * The cabin's half of the one-frame compositor.
 *
 * Car mode used to be a **second canvas**: a `WebGPURenderer` with
 * `alpha: true` stacked over the weather-post canvas and composited by the page
 * in CSS. That meant the composited image only ever existed in the browser's
 * compositor — cinema and snapshots had to rebuild it in 2D through
 * `car/runtime/frameCapture.ts`, and the road frame could never be an input to
 * the cabin.
 *
 * On the shared-device WebGPU cabin this redirects the cabin into a
 * `THREE.RenderTarget` instead and hands that target's `GPUTexture` to
 * `renderer/cabinComposite.ts`, which draws it over the swap chain inside the
 * road frame's own command encoder. The cabin canvas stays in the DOM (three
 * owns it, and `setSize` reads it) but is hidden while the compositor is live,
 * so nothing can be drawn twice.
 *
 * **`setOutputRenderTarget`, not `setRenderTarget`.** The former keeps three's
 * `isOutputTarget` true, so `renderer.outputColorSpace` still applies and the
 * texels match what the CSS-composited canvas held. `setRenderTarget` would
 * silently switch the cabin to linear working-space output and wash it out.
 *
 * Everything here degrades rather than throws: the WebGL hatch, a three build
 * without the API, or a backend that will not hand over the texture all put the
 * cabin back on the CSS overlay with its 2D cinema latch, and Street View
 * weather is untouched either way.
 */

/** Not part of three's public typings — see `readRenderTargetGpuTexture`. */
interface BackendTextureData {
    texture?: GPUTexture;
}

interface RendererWithBackend {
    backend?: { get?: (object: unknown) => BackendTextureData | undefined };
}

/**
 * Pull the `GPUTexture` three allocated for a render target's colour texture.
 *
 * three has no public accessor for this: `WebGPUBackend` keeps it on its
 * internal per-object data map (`backend.get(texture).texture`, written by
 * `WebGPUTextureUtils.createTexture`). It is allocated lazily on the first
 * render into the target and **replaced** when the target is resized, so this
 * is read per frame rather than cached.
 *
 * Returns null on anything unexpected, which is what stops a three upgrade that
 * moves this internal from turning into a blank cabin.
 */
export function readRenderTargetGpuTexture(
    renderer: CabinRenderer,
    target: THREE.RenderTarget,
): GPUTexture | null {
    const backend = (renderer as unknown as RendererWithBackend).backend;
    if (!backend || typeof backend.get !== 'function') return null;
    try {
        const texture = backend.get(target.texture)?.texture;
        // Duck-typed rather than `instanceof GPUTexture`: jsdom has no WebGPU
        // globals, and the fakes in tests are plain objects.
        return texture && typeof texture === 'object' && 'createView' in texture ? texture : null;
    } catch {
        return null;
    }
}

export interface CabinFrameTargetOptions {
    /** The cabin canvas, hidden while the compositor owns the frame. */
    canvas?: HTMLCanvasElement;
    /**
     * Multisample count for the cabin target. Defaults to the renderer's own
     * `samples`, which three derived from the `antialias` flag the GPU
     * performance profile chose — the canvas path got that antialiasing for
     * free, so the offscreen target has to ask for it explicitly or the cabin
     * silently gets jaggier. three attaches the MSAA texture and resolves into
     * the plain one, which is the texture `readRenderTargetGpuTexture` reads.
     */
    samples?: number;
    /**
     * Called once if the one-frame path has to be abandoned after it started.
     * The caller retracts the overlay source so cinema goes back to the latch.
     */
    onUnavailable?: (reason: string) => void;
}

export interface CabinFrameTargetCreateResult {
    target: CabinFrameTarget | null;
    /** Why the one-frame path does not apply. Undefined when `target` is set. */
    reason?: string;
}

export class CabinFrameTarget {
    private target: THREE.RenderTarget | null = null;
    private width = 0;
    private height = 0;
    /** Latched once the backend refuses the texture — stop re-asking every frame. */
    private failureReason: string | undefined;
    private disposed = false;

    private constructor(
        private readonly renderer: WebGPURenderer,
        private readonly options: CabinFrameTargetOptions,
    ) {}

    /**
     * Build a frame target for this cabin renderer, or explain why the
     * one-frame path does not apply.
     */
    public static create(
        renderer: CabinRenderer,
        options: CabinFrameTargetOptions = {},
    ): CabinFrameTargetCreateResult {
        if (!isWebGPUCabinRenderer(renderer)) {
            return {
                target: null,
                reason: 'Cabin is on the WebGL overlay — the one-frame compositor needs the shared GPUDevice.',
            };
        }
        if (typeof renderer.setOutputRenderTarget !== 'function') {
            return {
                target: null,
                reason: 'This three build has no setOutputRenderTarget — staying on the CSS cabin overlay.',
            };
        }
        return { target: new CabinFrameTarget(renderer, options) };
    }

    public isActive(): boolean {
        return !this.disposed && this.failureReason === undefined;
    }

    public getFailureReason(): string | undefined {
        return this.failureReason;
    }

    /**
     * Point the renderer at the offscreen target and hide the cabin canvas.
     * Call immediately before the cabin's `render()`, every frame — the target
     * is sized from the renderer's own drawing-buffer size, which follows the
     * device pixel ratio `applyPerformanceProfile` clamped it to.
     */
    public beginFrame(): void {
        if (!this.isActive()) return;
        this.ensureTarget();
        if (!this.target) return;
        this.renderer.setOutputRenderTarget(this.target);
        this.setCanvasHidden(true);
    }

    /**
     * Call immediately after the cabin's `render()`. The first frame is where a
     * backend that will not expose the texture shows up, so this is also where
     * the fallback latches.
     */
    public endFrame(): void {
        if (!this.isActive() || !this.target) return;
        if (readRenderTargetGpuTexture(this.renderer, this.target)) return;
        this.fail(
            'three did not expose a GPUTexture for the cabin render target — falling back to the CSS cabin overlay.',
        );
    }

    /**
     * The cabin colour texture for this frame, or null before the first draw.
     * Read once per road frame by `CabinCompositePass`.
     */
    public getTexture(): GPUTexture | null {
        if (!this.isActive() || !this.target) return null;
        return readRenderTargetGpuTexture(this.renderer, this.target);
    }

    /** Adapter for `renderer/cabinOverlayRegistry`. */
    public asOverlaySource(): CabinOverlaySource {
        return { getTexture: () => this.getTexture() };
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.detach();
        this.setCanvasHidden(false);
        try {
            this.target?.dispose();
        } catch {
            // Best-effort: a renderer already torn down owns these resources.
        }
        this.target = null;
    }

    private fail(reason: string): void {
        this.failureReason = reason;
        console.warn(`[cabinFrameTarget] ${reason}`);
        this.detach();
        this.setCanvasHidden(false);
        this.options.onUnavailable?.(reason);
    }

    private detach(): void {
        try {
            this.renderer.setOutputRenderTarget(null);
        } catch {
            // A disposed renderer refusing this is fine — nothing will draw.
        }
    }

    private setCanvasHidden(hidden: boolean): void {
        const canvas = this.options.canvas;
        if (!canvas) return;
        // `visibility`, not `display`: the cabin canvas is also the element
        // `CarInteriorRenderer.resize` and the pointer plumbing measure, and a
        // display:none canvas reports a zero client rect.
        canvas.style.visibility = hidden ? 'hidden' : 'visible';
    }

    private ensureTarget(): void {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        const width = Math.max(1, Math.floor(size.x));
        const height = Math.max(1, Math.floor(size.y));

        if (!this.target) {
            this.target = new THREE.RenderTarget(width, height, {
                format: THREE.RGBAFormat,
                type: THREE.UnsignedByteType,
                // Plain `rgba8unorm` on the GPU — only compressed formats get an
                // `-srgb` variant in three. The sRGB encode comes from
                // `renderer.outputColorSpace` through the output-target path.
                colorSpace: THREE.SRGBColorSpace,
                depthBuffer: true,
                stencilBuffer: false,
                samples: this.options.samples ?? this.renderer.samples ?? 0,
            });
            this.target.texture.name = 'cabinFrameTarget';
            this.width = width;
            this.height = height;
            return;
        }

        if (this.width !== width || this.height !== height) {
            this.target.setSize(width, height);
            this.width = width;
            this.height = height;
        }
    }
}
