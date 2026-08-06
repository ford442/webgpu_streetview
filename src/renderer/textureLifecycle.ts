import { getCanvasFingerprint } from '../utils/panoramaStability';
import { streetViewProbe } from '../utils/streetViewProbe';
import { WeatherPostProcessorLike } from './weatherPostProcessorTypes';

export interface TextureLifecycleDeps {
    getDevice: () => GPUDevice;
    getPipeline: () => GPURenderPipeline | undefined;
    getSampler: () => GPUSampler | undefined;
    getUniformBuffer: () => GPUBuffer | undefined;
    getTransitionPreviousFrame: () => GPUTexture | undefined;
    isHoldActive: () => boolean;
    getWeatherPostProcessor: () => WeatherPostProcessorLike | undefined;
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
    public bindGroup!: GPUBindGroup;

    constructor(private readonly deps: TextureLifecycleDeps) {}

    createTexture(width: number, height: number): void {
        if (this.texture) this.texture.destroy();

        this.texture = this.deps.getDevice().createTexture({
            size: [width, height],
            format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    createVideoTexture(width: number, height: number): void {
        if (this.videoTexture && this.videoTextureWidth === width && this.videoTextureHeight === height) {
            return;
        }

        if (this.videoTexture) this.videoTexture.destroy();

        this.videoTexture = this.deps.getDevice().createTexture({
            size: [width, height],
            format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.videoTextureWidth = width;
        this.videoTextureHeight = height;
    }

    ensureIntermediateTexture(width: number, height: number): void {
        if (this.intermediateTexture &&
            this.intermediateWidth === width &&
            this.intermediateHeight === height) {
            return;
        }

        if (this.intermediateTexture) {
            this.intermediateTexture.destroy();
        }

        this.intermediateWidth = width;
        this.intermediateHeight = height;

        this.intermediateTexture = this.deps.getDevice().createTexture({
            size: [width, height],
            format: 'rgba16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        this.intermediateTextureView = this.intermediateTexture.createView();
        this.deps.getWeatherPostProcessor()?.updateWeatherBindGroup(this.intermediateTextureView, width, height);
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

        const needsBindGroupUpdate = !this.videoTexture ||
            this.videoTextureWidth !== srcWidth ||
            this.videoTextureHeight !== srcHeight;

        const isCanvasSource = source instanceof HTMLCanvasElement;
        const sourceStable = !isCanvasSource || !!getCanvasFingerprint(source as HTMLCanvasElement);

        if (!sourceStable) {
            if (!this.videoTexture) {
                return false;
            }
            return true;
        }

        this.createVideoTexture(srcWidth, srcHeight);

        if (needsBindGroupUpdate) {
            this.updateBindGroup();
        }

        try {
            this.deps.getDevice().queue.copyExternalImageToTexture(
                { source: source as GPUCopyExternalImageSource },
                { texture: this.videoTexture! },
                [srcWidth, srcHeight]
            );
        } catch {
            // Ignore transient copy errors
        }

        return true;
    }

    destroyTextures(): void {
        if (this.texture) this.texture.destroy();
        if (this.videoTexture) this.videoTexture.destroy();
        if (this.intermediateTexture) this.intermediateTexture.destroy();
    }
}
