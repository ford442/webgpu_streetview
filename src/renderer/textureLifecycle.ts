import { mapsCanvasSource } from './frameSource/mapsCanvasSource';
import { streetViewProbe } from '../utils/streetViewProbe';
import { type WeatherPostProcessorLike } from './weatherPostProcessorTypes';
import { HDR_INTERMEDIATE_FORMAT } from './shaderFeatureVariants';
import { createTrackedTexture, destroyTracked } from './gpuMemoryTracking';
import { clampTextureSize } from './deviceInit';

export interface TextureLifecycleDeps {
    getDevice: () => GPUDevice;
    getPipeline: () => GPURenderPipeline | undefined;
    getSampler: () => GPUSampler | undefined;
    getUniformBuffer: () => GPUBuffer | undefined;
    getTransitionPreviousFrame: () => GPUTexture | undefined;
    isHoldActive: () => boolean;
    getWeatherPostProcessor: () => WeatherPostProcessorLike | undefined;
    /**
     * Does a canvas source show imagery yet? Defaults to the shared Maps
     * canvas verdict (`mapsCanvasSource.isShowingImagery`), which never reads
     * back on the frame path.
     */
    isCanvasShowingImagery?: (canvas: HTMLCanvasElement) => boolean;
}

/**
 * GPU texture creation, intermediate HDR target, bind groups, and live source uploads.
 */
export class TextureLifecycle {
    public texture!: GPUTexture;
    public videoTexture?: GPUTexture;
    public videoTextureWidth = 0;
    public videoTextureHeight = 0;
    public intermediateTexture!: GPUTexture;
    public intermediateTextureView!: GPUTextureView;
    public intermediateWidth = 0;
    public intermediateHeight = 0;
    public intermediateFormat: GPUTextureFormat = HDR_INTERMEDIATE_FORMAT;
    public bindGroup!: GPUBindGroup;

    /** Scratch 2D canvas for the rare source larger than `maxTextureDimension2D`. */
    private downscaleCanvas: HTMLCanvasElement | null = null;

    constructor(private readonly deps: TextureLifecycleDeps) {}

    /** The device's 2D texture limit (core default when the device does not say). */
    private maxTextureDimension(): number {
        const limit = Number(this.deps.getDevice()?.limits?.maxTextureDimension2D);
        return Number.isFinite(limit) && limit > 0 ? limit : 8192;
    }

    createTexture(width: number, height: number): void {
        destroyTracked(this.texture);

        this.texture = createTrackedTexture(this.deps.getDevice(), {
            size: [width, height],
            format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        }, 'sv-source');
    }

    createVideoTexture(width: number, height: number): void {
        if (this.videoTexture && this.videoTextureWidth === width && this.videoTextureHeight === height) {
            return;
        }

        destroyTracked(this.videoTexture);

        this.videoTexture = createTrackedTexture(this.deps.getDevice(), {
            size: [width, height],
            format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
        }, 'sv-video');
        this.videoTextureWidth = width;
        this.videoTextureHeight = height;
    }

    setIntermediateFormat(format: GPUTextureFormat): void {
        if (this.intermediateFormat === format) return;
        this.intermediateFormat = format;
        this.intermediateWidth = 0;
        this.intermediateHeight = 0;
    }

    ensureIntermediateTexture(width: number, height: number): void {
        // The canvas is sized within the device limit already (see
        // `canvasBackingStore.ts`); this is the backstop so an oversize canvas
        // can never make pass 1's render target invalid.
        const size = clampTextureSize(width, height, this.maxTextureDimension());
        if (this.intermediateTexture &&
            this.intermediateWidth === size.width &&
            this.intermediateHeight === size.height) {
            return;
        }

        destroyTracked(this.intermediateTexture);

        this.intermediateWidth = size.width;
        this.intermediateHeight = size.height;

        this.intermediateTexture = createTrackedTexture(this.deps.getDevice(), {
            size: [size.width, size.height],
            format: this.intermediateFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        }, 'sv-intermediate');

        this.intermediateTextureView = this.intermediateTexture.createView();
        this.deps.getWeatherPostProcessor()?.updateWeatherBindGroup(
            this.intermediateTextureView,
            size.width,
            size.height,
        );
    }

    updateBindGroup(): void {
        const pipeline = this.deps.getPipeline();
        const sampler = this.deps.getSampler();
        const uniformBuffer = this.deps.getUniformBuffer();
        if (!pipeline || !this.texture || !sampler || !uniformBuffer) return;

        const textureView = (this.videoTexture ? this.videoTexture.createView() : this.texture.createView());
        const prevFrame = this.deps.getTransitionPreviousFrame();

        this.bindGroup = this.deps.getDevice().createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: textureView },
                { binding: 2, resource: { buffer: uniformBuffer } },
                { binding: 3, resource: (prevFrame ? prevFrame.createView() : textureView) },
            ],
        });
    }

    uploadLiveSource(source: CanvasImageSource): boolean {
        if (this.deps.isHoldActive()) {
            streetViewProbe.warnLeak(
                'uploadLiveSource() called while holdActive=true — the renderStreetView() hold guard was bypassed.'
            );
            return !!this.videoTexture;
        }

        let srcWidth = 0;
        let srcHeight = 0;

        if (source instanceof HTMLCanvasElement) {
            srcWidth = source.width;
            srcHeight = source.height;
        } else if (source instanceof HTMLVideoElement) {
            if (source.readyState >= 2) {
                srcWidth = source.videoWidth;
                srcHeight = source.videoHeight;
            }
        } else if (source instanceof ImageBitmap) {
            srcWidth = source.width;
            srcHeight = source.height;
        }

        if (srcWidth <= 0 || srcHeight <= 0) {
            return false;
        }

        const isCanvasSource = source instanceof HTMLCanvasElement;
        if (isCanvasSource && !this.canvasShowsImagery(source)) {
            return !!this.videoTexture;
        }

        // A source over the device limit (a huge window at DPR 2 under a
        // compat device) is downscaled into the largest texture that fits,
        // rather than failing the copy every frame.
        const fit = clampTextureSize(srcWidth, srcHeight, this.maxTextureDimension());
        const uploadSource = fit.clamped ? this.downscale(source, fit.width, fit.height) : source;
        if (!uploadSource) return !!this.videoTexture;

        const needsBindGroupUpdate = !this.videoTexture ||
            this.videoTextureWidth !== fit.width ||
            this.videoTextureHeight !== fit.height;

        this.createVideoTexture(fit.width, fit.height);

        if (needsBindGroupUpdate) {
            this.updateBindGroup();
        }

        try {
            this.deps.getDevice().queue.copyExternalImageToTexture(
                { source: uploadSource as GPUCopyExternalImageSource },
                { texture: this.videoTexture! },
                [fit.width, fit.height]
            );
        } catch {
            // Ignore transient copy errors
        }

        return true;
    }

    private canvasShowsImagery(canvas: HTMLCanvasElement): boolean {
        const custom = this.deps.isCanvasShowingImagery;
        return custom ? custom(canvas) : mapsCanvasSource.isShowingImagery(canvas);
    }

    /** GPU-side 2D scale (no readback) into a reusable scratch canvas. */
    private downscale(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement | null {
        if (typeof document === 'undefined') return null;
        if (!this.downscaleCanvas) this.downscaleCanvas = document.createElement('canvas');
        const scratch = this.downscaleCanvas;
        if (scratch.width !== width) scratch.width = width;
        if (scratch.height !== height) scratch.height = height;
        const ctx = scratch.getContext('2d');
        if (!ctx) return null;
        try {
            ctx.drawImage(source, 0, 0, width, height);
        } catch {
            return null;
        }
        return scratch;
    }

    destroyTextures(): void {
        destroyTracked(this.texture);
        destroyTracked(this.videoTexture);
        destroyTracked(this.intermediateTexture);
    }
}
