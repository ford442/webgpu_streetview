/**
 * The render-scale upscale (#329): the road frame the weather pass wrote at
 * `canvas × scale` → the swap chain, between weather and the cabin composite.
 *
 * Owns the scaled **road target** the weather pass draws into whenever the
 * scale is below 1 (`ensureInput`, `presentationFormat`, so the weather
 * pipelines need no variant), FSR 1.0's EASU output (rgba16float at output
 * size), three pipelines from `upscale.wgsl` and its own 32-byte uniform
 * buffer. At scale 1 it is never encoded and holds no textures — a frame there
 * is the pre-#329 frame.
 *
 * - `fsr` (default): EASU (scaled road → EASU texture) then RCAS (→ swap
 *   chain), two passes; the upscale timestamp span opens on the first and
 *   closes on the second.
 * - `bilinear` (`?upscale=bilinear`): one filtered stretch into the swap chain.
 *
 * Optional and lazy: built the first time a scale below 1 is requested (until
 * then, and if it fails to build, `Renderer` keeps the road at scale 1 —
 * `limitedBy: 'upscale-pending' | 'upscale-unavailable'`). Weather can only
 * render at the intermediate's size, so a scaled frame without this pass would
 * have nothing to present it.
 */
import { PUBLIC_URL } from '../../config/publicUrl';
import {
    createRenderPipelineChecked,
    createShaderModuleChecked,
    fetchShaderSource,
} from '../gpuPipelineFactory';
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';
import { timestampWritesField, type GpuPassTimer } from '../gpuPassTimer';

export type UpscaleMode = 'fsr' | 'bilinear';

const UPSCALE_SHADER_PATH = 'shaders/upscale.wgsl';
/** EASU's output, RCAS's input: full output size, float so the 8-bit road is not requantised in between. */
export const EASU_OUTPUT_FORMAT: GPUTextureFormat = 'rgba16float';
/** `UpscaleUniforms` in `upscale.wgsl`: inputSize, outputSize, sharpness, peak, 2 pad. */
const UPSCALE_UNIFORM_FLOAT_COUNT = 8;
/** RCAS sharpness in stops below the maximum (0 = sharpest); FSR's sample default. */
export const RCAS_SHARPNESS_STOPS = 0.2;

export interface UpscaleTimingContext {
    timer: GpuPassTimer;
    startIndex: number;
    endIndex: number;
}

export interface UpscaleUniformInput {
    inputWidth: number;
    inputHeight: number;
    outputWidth: number;
    outputHeight: number;
    sharpnessStops: number;
    /** RCAS limiter ceiling — 1 on an SDR swap chain, the extended headroom on `?hdr`. */
    peak: number;
}

/** Pack `UpscaleUniforms`. Pass `out` to reuse one array — `writeBuffer` copies it. */
export function packUpscaleUniforms(
    input: UpscaleUniformInput,
    out: Float32Array<ArrayBuffer> = new Float32Array(UPSCALE_UNIFORM_FLOAT_COUNT),
): Float32Array<ArrayBuffer> {
    out[0] = input.inputWidth;
    out[1] = input.inputHeight;
    out[2] = input.outputWidth;
    out[3] = input.outputHeight;
    // FsrRcasCon: con.x = exp2(-sharpness).
    out[4] = Math.pow(2, -input.sharpnessStops);
    out[5] = input.peak;
    out[6] = 0;
    out[7] = 0;
    return out;
}

export interface UpscaleInitOptions {
    peak: number;
}

interface SizedTexture {
    texture: GPUTexture;
    view: GPUTextureView;
    width: number;
    height: number;
}

export class UpscalePass {
    private layout: GPUBindGroupLayout | null = null;
    private easuPipeline: GPURenderPipeline | null = null;
    private rcasPipeline: GPURenderPipeline | null = null;
    private bilinearPipeline: GPURenderPipeline | null = null;
    private sampler: GPUSampler | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private presentationFormat: GPUTextureFormat | null = null;
    private peak = 1;

    private input: SizedTexture | null = null;
    private easuOutput: SizedTexture | null = null;
    /** Rebuilt whenever the texture it binds is replaced. */
    private inputBindGroup: GPUBindGroup | null = null;
    private easuBindGroup: GPUBindGroup | null = null;

    private readonly uniforms = new Float32Array(UPSCALE_UNIFORM_FLOAT_COUNT);
    private readonly uploaded = new Float32Array(UPSCALE_UNIFORM_FLOAT_COUNT);
    private uniformsValid = false;
    private disposed = false;

    constructor(
        private readonly device: GPUDevice,
        private readonly mode: UpscaleMode,
    ) {}

    public getMode(): UpscaleMode {
        return this.mode;
    }

    public async init(presentationFormat: GPUTextureFormat, options: UpscaleInitOptions): Promise<void> {
        const url = `${PUBLIC_URL}/${UPSCALE_SHADER_PATH}`;
        const code = await fetchShaderSource(url, 'upscale.wgsl');
        if (this.disposed) return;
        const module = await createShaderModuleChecked(this.device, { label: 'upscale.wgsl', code });

        const layout = this.device.createBindGroupLayout({
            label: 'upscale-bind-group-layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ],
        });
        const pipelineLayout = this.device.createPipelineLayout({
            label: 'upscale-pipeline-layout',
            bindGroupLayouts: [layout],
        });
        const pipeline = (name: string, entryPoint: string, format: GPUTextureFormat) =>
            createRenderPipelineChecked(this.device, {
                label: name,
                layout: pipelineLayout,
                vertex: { module, entryPoint: 'vs_main' },
                fragment: { module, entryPoint, targets: [{ format }] },
                primitive: { topology: 'triangle-list' },
            });

        if (this.mode === 'fsr') {
            const [easu, rcas] = await Promise.all([
                pipeline('upscale-easu-pipeline', 'fs_easu', EASU_OUTPUT_FORMAT),
                pipeline('upscale-rcas-pipeline', 'fs_rcas', presentationFormat),
            ]);
            this.easuPipeline = easu;
            this.rcasPipeline = rcas;
        } else {
            this.bilinearPipeline = await pipeline('upscale-bilinear-pipeline', 'fs_bilinear', presentationFormat);
        }
        if (this.disposed) return;

        this.sampler = this.device.createSampler({
            label: 'upscale-sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this.uniformBuffer = createTrackedBuffer(this.device, {
            label: 'upscale-uniforms',
            size: UPSCALE_UNIFORM_FLOAT_COUNT * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }, 'upscale-uniforms');
        this.peak = options.peak;
        this.presentationFormat = presentationFormat;
        // Last: `isReady()` turns true only for pipelines that passed validation.
        this.layout = layout;
    }

    public isReady(): boolean {
        return !this.disposed && this.layout !== null;
    }

    /**
     * The scaled road target for this frame — what the weather pass draws into
     * instead of the swap chain. Recreated when the size changes; undefined
     * before `init` has succeeded.
     */
    public ensureInput(width: number, height: number): GPUTextureView | undefined {
        if (!this.isReady() || !this.presentationFormat) return undefined;
        if (this.input?.width !== width || this.input?.height !== height) {
            destroyTracked(this.input?.texture);
            this.input = this.createTarget('upscale-input', this.presentationFormat, width, height);
            this.inputBindGroup = null;
        }
        return this.input.view;
    }

    /**
     * Encode the upscale from the road target into `outputView` (the swap
     * chain). False — nothing encoded — before `init`, or before the weather
     * pass has had a road target this frame.
     */
    public encode(
        encoder: GPUCommandEncoder,
        outputView: GPUTextureView,
        outputWidth: number,
        outputHeight: number,
        timing?: UpscaleTimingContext,
    ): boolean {
        const input = this.input;
        if (!this.isReady() || !input) return false;
        this.writeUniforms(input.width, input.height, outputWidth, outputHeight);

        if (this.mode === 'bilinear') {
            this.inputBindGroup ??= this.bindGroup('upscale-bilinear-bind-group', input.view);
            this.drawPass(encoder, 'upscale-bilinear', outputView, this.bilinearPipeline!, this.inputBindGroup, timing, true, true);
            return true;
        }

        if (this.easuOutput?.width !== outputWidth || this.easuOutput?.height !== outputHeight) {
            destroyTracked(this.easuOutput?.texture);
            this.easuOutput = this.createTarget('upscale-easu', EASU_OUTPUT_FORMAT, outputWidth, outputHeight);
            this.easuBindGroup = null;
        }
        this.inputBindGroup ??= this.bindGroup('upscale-easu-bind-group', input.view);
        this.easuBindGroup ??= this.bindGroup('upscale-rcas-bind-group', this.easuOutput.view);
        this.drawPass(encoder, 'upscale-easu', this.easuOutput.view, this.easuPipeline!, this.inputBindGroup, timing, true, false);
        this.drawPass(encoder, 'upscale-rcas', outputView, this.rcasPipeline!, this.easuBindGroup, timing, false, true);
        return true;
    }

    public dispose(): void {
        this.disposed = true;
        destroyTracked(this.input?.texture);
        destroyTracked(this.easuOutput?.texture);
        destroyTracked(this.uniformBuffer);
        this.input = null;
        this.easuOutput = null;
        this.inputBindGroup = null;
        this.easuBindGroup = null;
        this.uniformBuffer = null;
        this.layout = null;
        this.easuPipeline = null;
        this.rcasPipeline = null;
        this.bilinearPipeline = null;
        this.sampler = null;
    }

    private createTarget(label: string, format: GPUTextureFormat, width: number, height: number): SizedTexture {
        const texture = createTrackedTexture(this.device, {
            label,
            size: [width, height],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        }, label);
        return { texture, view: texture.createView(), width, height };
    }

    private bindGroup(label: string, view: GPUTextureView): GPUBindGroup {
        return this.device.createBindGroup({
            label,
            layout: this.layout!,
            entries: [
                { binding: 0, resource: view },
                { binding: 1, resource: this.sampler! },
                { binding: 2, resource: { buffer: this.uniformBuffer! } },
            ],
        });
    }

    /** One `writeBuffer` when the sizes change, none on a steady frame. */
    private writeUniforms(inputWidth: number, inputHeight: number, outputWidth: number, outputHeight: number): void {
        packUpscaleUniforms({
            inputWidth,
            inputHeight,
            outputWidth,
            outputHeight,
            sharpnessStops: RCAS_SHARPNESS_STOPS,
            peak: this.peak,
        }, this.uniforms);
        if (this.uniformsValid && this.uniforms.every((v, i) => v === this.uploaded[i])) return;
        this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.uniforms);
        this.uploaded.set(this.uniforms);
        this.uniformsValid = true;
    }

    private drawPass(
        encoder: GPUCommandEncoder,
        label: string,
        view: GPUTextureView,
        pipeline: GPURenderPipeline,
        bindGroup: GPUBindGroup,
        timing: UpscaleTimingContext | undefined,
        opensSpan: boolean,
        closesSpan: boolean,
    ): void {
        const pass = encoder.beginRenderPass({
            label,
            colorAttachments: [{
                view,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
            ...timestampWritesField(timing?.timer.renderPassTimestampWrites(
                opensSpan ? timing.startIndex : undefined,
                closesSpan ? timing.endIndex : undefined,
            )),
        });
        if (timing && opensSpan) timing.timer.markPassStart(pass, timing.startIndex);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3, 1, 0, 0);
        if (timing && closesSpan) timing.timer.markPassEnd(pass, timing.endIndex);
        pass.end();
    }
}
