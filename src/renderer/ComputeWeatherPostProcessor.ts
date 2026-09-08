import { WeatherParamIndex } from './weatherUniformLayout';
import type { WeatherPostProcessorLike, WeatherPassTimingContext } from './weatherPostProcessorTypes';
import type { LutVolume } from './lut';
import { ComputeWeatherResources } from './computeWeather/resources';
import { ComputeWeatherParticles } from './computeWeather/particles';
import { ComputeWeatherLut } from './computeWeather/lut';
import { WeatherParamBlock } from './computeWeather/weatherParams';
import {
    createBlitBindGroup,
    createBlitPipeline,
    createWeatherBindGroup,
    createWeatherComputePipeline,
} from './computeWeather/pipeline';
import {
    recordBlitPass,
    recordColorHistoryCopy,
    recordIntermediateClear,
    recordWeatherPass,
} from './computeWeather/dispatch';

/**
 * Compute-shader variant of the weather post-processing pass. Renders the
 * same rain/snow/fog/color-grading effects as WeatherPostProcessor but via
 * a compute pipeline writing into a storage texture, then blits that
 * texture to the canvas. Exposes the same public API as
 * WeatherPostProcessor so Renderer.ts can use either interchangeably.
 *
 * This class is a **façade** — it owns pipeline creation, bind-group assembly
 * and frame ordering, and delegates everything else to `computeWeather/`:
 *
 * | Concern | File |
 * |---|---|
 * | Sizes, workgroup, blit shader | `computeWeather/constants.ts` |
 * | Samplers, buffers, dummies, write/depth/history textures | `computeWeather/resources.ts` |
 * | GPU precipitation (state ping-pong, density, 3 pipelines) | `computeWeather/particles.ts` |
 * | Look-LUT texture swap (bind group 1) | `computeWeather/lut.ts` |
 * | The shared 40-float parameter block | `computeWeather/weatherParams.ts` |
 * | Bind-group layouts + builders (binding indices) | `computeWeather/pipeline.ts` |
 * | Pass recording and ordering | `computeWeather/dispatch.ts` |
 *
 * Two of the image_video_effects storage surfaces carry real data: binding 6
 * receives a full-res view-depth proxy each dispatch, and binding 12 carries
 * the WASM noise tile (#128) that drives dust turbulence — an fBm tile on this
 * path, where the fragment path gets a single octave (see
 * src/wasm/wasmNoiseFeeder.ts and docs/WASM_BRIDGE.md). Bindings 7/8 hold
 * GPU precipitation when `updateParticleSeeds` has run: 7 is a half-res
 * density splat (`texture_2d` read), 8 is the compact particle-state write
 * target. See docs/RENDERER_FALLBACK.md and docs/GRAPHICS.md.
 *
 * Behaviour is pinned by
 * `computeWeather/__tests__/computeWeather.characterization.test.ts`, which
 * asserts binding indices, ping-pong ordering and pass sequence against a fake
 * GPUDevice. Those tests were written against the pre-split class and pass
 * unchanged here.
 */
export class ComputeWeatherPostProcessor implements WeatherPostProcessorLike {
    private device: GPUDevice;
    private context: GPUCanvasContext;

    private readonly resources: ComputeWeatherResources;
    private readonly particles: ComputeWeatherParticles;
    private readonly lut: ComputeWeatherLut;
    private readonly params: WeatherParamBlock;

    private computePipeline: GPUComputePipeline | null = null;
    private computeBindGroup: GPUBindGroup | null = null;
    private blitPipeline: GPURenderPipeline | null = null;
    private blitBindGroup: GPUBindGroup | null = null;

    private temporalHistoryEnabled = false;
    private shaderEffectsEnabled = true;
    private lastIntermediateView: GPUTextureView | null = null;

    constructor(device: GPUDevice, context: GPUCanvasContext, _canvas: HTMLCanvasElement) {
        this.device = device;
        this.context = context;

        this.resources = new ComputeWeatherResources(device);
        this.particles = new ComputeWeatherParticles(device);
        this.lut = new ComputeWeatherLut(device);
        this.params = new WeatherParamBlock(device, () => this.resources.extraBuffer);
    }

    public async init(presentationFormat: GPUTextureFormat): Promise<void> {
        const base = process.env.PUBLIC_URL || '/';

        this.computePipeline = await createWeatherComputePipeline(
            this.device,
            `${base}/shaders/weather-post-compute.wgsl`,
            this.lut.createLayout(),
        );
        this.lut.rebuild();

        await this.particles.initPipelines(`${base}/shaders/weather-particles.wgsl`);

        this.blitPipeline = createBlitPipeline(this.device, presentationFormat);
    }

    private rebuildComputeBindGroup(intermediateTextureView: GPUTextureView): void {
        const res = this.resources;
        if (this.particles.isEnabled()) {
            this.particles.ensureDensityTexture(res.writeWidth, res.writeHeight);
        }
        const depthRead = res.getDepthReadTexture();
        const depthWrite = res.getDepthWriteTexture();
        if (
            !this.computePipeline
            || !this.blitPipeline
            || !res.writeTexture
            || !depthRead
            || !depthWrite
            || !res.isReady()
        ) {
            return;
        }

        this.computeBindGroup = createWeatherBindGroup(this.device, this.computePipeline, {
            filteringSampler: res.filteringSampler!,
            intermediateView: intermediateTextureView,
            writeTexture: res.writeTexture,
            computeUniformsBuffer: res.computeUniformsBuffer!,
            depthReadTexture: depthRead,
            nonFilteringSampler: res.nonFilteringSampler!,
            depthWriteTexture: depthWrite,
            densityView: this.particles.getDensityView(res.dummyDataTextureA!),
            particleStateWriteView: this.particles.getStateWriteView(res.dummyDataTextureB!),
            colorHistoryView: res.getColorHistoryView(this.temporalHistoryEnabled),
            extraBuffer: res.extraBuffer!,
            comparisonSampler: res.comparisonSampler!,
            noiseBuffer: res.noiseBuffer!,
        });

        this.blitBindGroup = createBlitBindGroup(this.device, this.blitPipeline, res.writeTexture);
    }

    public setLookLut(volume: LutVolume | null): void {
        this.lut.setVolume(volume);
    }

    public setTemporalHistoryEnabled(enabled: boolean): void {
        if (this.temporalHistoryEnabled === enabled) return;
        this.temporalHistoryEnabled = enabled;
        if (!enabled) this.resources.historyReady = false;
        if (this.lastIntermediateView) this.rebuildComputeBindGroup(this.lastIntermediateView);
    }

    public updateWeatherBindGroup(intermediateTextureView: GPUTextureView, width?: number, height?: number): void {
        if (!this.computePipeline || !this.blitPipeline || !intermediateTextureView || !this.resources.isReady()) {
            return;
        }

        if (this.resources.ensureWriteTexture(width || 1, height || 1)) {
            this.particles.ensureDensityTexture(this.resources.writeWidth, this.resources.writeHeight);
        }
        if (!this.resources.writeTexture) return;

        this.lastIntermediateView = intermediateTextureView;
        this.rebuildComputeBindGroup(intermediateTextureView);
    }

    public updateNoiseBuffer(tile: Float32Array): void {
        if (!this.resources.noiseBuffer || !this.device) return;
        this.device.queue.writeBuffer(this.resources.noiseBuffer, 0, tile);
    }

    /**
     * Upload WASM particle seeds (4 floats/particle) into the compact state
     * textures. Enables bindings 7/8 for subsequent dispatches. `seeds.length`
     * must be `width * height * 4`.
     */
    public updateParticleSeeds(seeds: Float32Array, width: number, height: number): void {
        if (!this.device) return;
        if (!this.particles.uploadSeeds(seeds, width, height, this.params.getTime())) return;
        if (this.lastIntermediateView) {
            this.rebuildComputeBindGroup(this.lastIntermediateView);
        }
    }

    /** True when bindings 7/8 are the real particle textures (not 1×1 dummies). */
    public areParticleTexturesActive(): boolean {
        return this.particles.isActive();
    }

    public setShaderEffects(enabled: boolean): void {
        this.shaderEffectsEnabled = enabled;
        this.params.setShaderEffects(enabled);
    }

    public getShaderEffectsEnabled(): boolean {
        return this.shaderEffectsEnabled;
    }

    public getCameraParams(): { heading: number; pitch: number } {
        return this.params.getCamera();
    }

    public updateWeatherParams(params: Float32Array): void {
        this.params.setAll(params);
    }

    public updateCameraParams(heading: number, pitch: number): void {
        this.params.setCamera(heading, pitch);
    }

    public updateColorParams(params: Float32Array): void {
        this.params.setColor(params);
    }

    public updateWeatherAnimation(): void {
        if (!this.device || !this.resources.extraBuffer) return;
        this.params.tick();
    }

    private dispatch(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void {
        const res = this.resources;
        if (
            !this.computeBindGroup
            || !this.computePipeline
            || !res.computeUniformsBuffer
            || res.writeWidth <= 0
            || res.writeHeight <= 0
        ) {
            return;
        }

        this.device.queue.writeBuffer(
            res.computeUniformsBuffer,
            0,
            new Float32Array([this.params.get(WeatherParamIndex.time), 0, res.writeWidth, res.writeHeight]),
        );

        const particlesRan = this.particles.dispatch(
            commandEncoder,
            res.extraBuffer,
            this.params.raw(),
            res.writeWidth,
            res.writeHeight,
        );

        recordWeatherPass(commandEncoder, {
            pipeline: this.computePipeline,
            bindGroup: this.computeBindGroup,
            lutBindGroup: this.lut.getBindGroup(),
            width: res.writeWidth,
            height: res.writeHeight,
            timing,
        });

        res.swapDepthPingPong();
        if (particlesRan) {
            this.particles.swapIfActive();
        }
        if (this.lastIntermediateView) {
            this.rebuildComputeBindGroup(this.lastIntermediateView);
        }
    }

    private blit(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void {
        if (!this.blitBindGroup || !this.blitPipeline) return;
        recordBlitPass(commandEncoder, {
            pipeline: this.blitPipeline,
            bindGroup: this.blitBindGroup,
            targetView: this.context.getCurrentTexture().createView(),
            timing,
        });
        this.copyColorHistory(commandEncoder);
    }

    private copyColorHistory(commandEncoder: GPUCommandEncoder): void {
        const res = this.resources;
        const copied = recordColorHistoryCopy(commandEncoder, {
            enabled: this.temporalHistoryEnabled,
            writeTexture: res.writeTexture,
            colorHistoryTexture: res.colorHistoryTexture,
            width: res.writeWidth,
            height: res.writeHeight,
        });
        if (!copied) return;
        res.historyReady = true;
        if (this.lastIntermediateView) {
            this.rebuildComputeBindGroup(this.lastIntermediateView);
        }
    }

    public renderWeatherOnly(intermediateTextureView: GPUTextureView): void {
        if (!this.device || !this.computePipeline) return;

        try {
            this.updateWeatherAnimation();

            const commandEncoder = this.device.createCommandEncoder();
            recordIntermediateClear(commandEncoder, intermediateTextureView);

            this.dispatch(commandEncoder);
            this.blit(commandEncoder);

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress errors during weather-only rendering
        }
    }

    public renderPass(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void {
        this.dispatch(commandEncoder, timing);
        this.blit(commandEncoder, timing);
    }

    public dispose(): void {
        this.resources.dispose();
        this.particles.dispose();
        this.lut.dispose();
        this.computePipeline = null;
        this.computeBindGroup = null;
        this.blitPipeline = null;
        this.blitBindGroup = null;
    }
}
