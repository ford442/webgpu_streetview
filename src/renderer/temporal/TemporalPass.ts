/**
 * The temporal resolve (#360): the jittered road frame the weather pass wrote
 * at the intermediate's size → the swap chain, accumulated over frames along
 * the motion field. It takes the `upscale` pass's place in the frame whenever
 * it presents (`?temporal`, `temporalMath.wantsTemporal`).
 *
 * Owns:
 * - the **road target** the weather pass draws into (`ensureInput`,
 *   `presentationFormat` — the same contract as `UpscalePass.ensureInput`);
 * - the `MotionVectorPass` (`motion.wgsl`) and its field;
 * - two `rgba16float` history textures at the output size, ping-ponged (rgb
 *   the resolved colour, a the accumulated weight);
 * - the resolve pipeline (`temporal.wgsl` → the next history) and the present
 *   pipeline (`upscale.wgsl`'s RCAS, history → swap chain: FSR 2's order —
 *   the history is never sharpened, only what is shown), each with its own
 *   small uniform buffer.
 *
 * Built lazily through `gpuPipelineFactory` the first time a frame wants it.
 * Any of the three shaders failing rejects `init` — the frame then presents
 * through `upscale` and `webgpuProbe.passes.temporal` says why.
 *
 * What may blend history is decided on the CPU (`TemporalHistoryTracker`,
 * by `Renderer`); this pass also refuses history on the frame its history
 * textures were (re)created. The windshield portal never sees any of this: it
 * samples the scaled intermediate (`roadFrameRegistry.ts`).
 */
import { PUBLIC_URL } from '../../config/publicUrl';
import {
    createRenderPipelineChecked,
    createShaderModuleChecked,
    fetchShaderSource,
} from '../gpuPipelineFactory';
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';
import { timestampWritesField, type GpuPassTimer } from '../gpuPassTimer';
import { packUpscaleUniforms } from '../upscale/UpscalePass';
import { MotionVectorPass } from './motionVectors';
import {
    TEMPORAL_HISTORY_FORMAT,
    TEMPORAL_RCAS_SHARPNESS_STOPS,
    TEMPORAL_UNIFORM_FLOAT_COUNT,
    packTemporalUniforms,
} from './temporalMath';

const TEMPORAL_SHADER_PATH = 'shaders/temporal.wgsl';
const RCAS_SHADER_PATH = 'shaders/upscale.wgsl';
/** `UpscaleUniforms` in `upscale.wgsl`. */
const RCAS_UNIFORM_FLOAT_COUNT = 8;

export interface TemporalTimingContext {
    timer: GpuPassTimer;
    startIndex: number;
    endIndex: number;
}

export interface TemporalInitOptions {
    /** Output ceiling — 1 on an SDR swap chain, the extended headroom on `?hdr`. */
    peak: number;
    /** RCAS strength in stops below the maximum; `Infinity` presents the history unsharpened. */
    sharpnessStops?: number;
}

/** This frame's CPU-side decisions, set by `Renderer` before the encode. */
export interface TemporalFrameState {
    /** `packMotionUniforms` for this frame (mode `none` zeroes the field). */
    motionUniforms: Float32Array<ArrayBuffer>;
    /** The jitter pass 1 sampled with, intermediate pixels. */
    jitter: readonly [number, number];
    /** Whether the resolve may blend last frame's output. */
    history: boolean;
}

interface SizedTexture {
    texture: GPUTexture;
    view: GPUTextureView;
    width: number;
    height: number;
}

interface BuiltPipeline {
    layout: GPUBindGroupLayout;
    pipeline: GPURenderPipeline;
}

export class TemporalPass {
    private readonly motion: MotionVectorPass;
    private resolve: BuiltPipeline | null = null;
    private present: BuiltPipeline | null = null;
    private sampler: GPUSampler | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private rcasUniformBuffer: GPUBuffer | null = null;
    private presentationFormat: GPUTextureFormat | null = null;
    private peak = 1;
    private sharpnessStops = TEMPORAL_RCAS_SHARPNESS_STOPS;

    private input: SizedTexture | null = null;
    private readonly histories: [SizedTexture | null, SizedTexture | null] = [null, null];
    /** The history the next resolve writes; the other one is read. */
    private writeIndex = 0;
    /** No history has been written into the current textures yet. */
    private historyFresh = true;
    /** Resolve bind groups, one per read index; rebuilt when a texture they bind is replaced. */
    private readonly resolveGroups: [GPUBindGroup | null, GPUBindGroup | null] = [null, null];
    /** Present bind groups, one per history (the one just written is shown). */
    private readonly presentGroups: [GPUBindGroup | null, GPUBindGroup | null] = [null, null];
    private boundMotionView: GPUTextureView | null = null;

    private state: TemporalFrameState | null = null;
    private readonly uniforms = new Float32Array(TEMPORAL_UNIFORM_FLOAT_COUNT);
    private readonly rcasUniforms = new Float32Array(RCAS_UNIFORM_FLOAT_COUNT);
    private readonly rcasUploaded = new Float32Array(RCAS_UNIFORM_FLOAT_COUNT);
    private rcasUniformsValid = false;
    private disposed = false;
    private encodes = 0;

    constructor(private readonly device: GPUDevice) {
        this.motion = new MotionVectorPass(device);
    }

    public async init(presentationFormat: GPUTextureFormat, options: TemporalInitOptions): Promise<void> {
        const build = async (
            path: string,
            name: string,
            label: string,
            entryPoint: string,
            format: GPUTextureFormat,
            entries: GPUBindGroupLayoutEntry[],
        ): Promise<BuiltPipeline | null> => {
            const code = await fetchShaderSource(`${PUBLIC_URL}/${path}`, name);
            if (this.disposed) return null;
            const module = await createShaderModuleChecked(this.device, { label: name, code });
            const layout = this.device.createBindGroupLayout({ label: `${label}-bind-group-layout`, entries });
            const pipeline = await createRenderPipelineChecked(this.device, {
                label: `${label}-pipeline`,
                layout: this.device.createPipelineLayout({ label: `${label}-pipeline-layout`, bindGroupLayouts: [layout] }),
                vertex: { module, entryPoint: 'vs_main' },
                fragment: { module, entryPoint, targets: [{ format }] },
                primitive: { topology: 'triangle-list' },
            });
            return { layout, pipeline };
        };
        const texture = (binding: number): GPUBindGroupLayoutEntry =>
            ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
        const sampler = (binding: number): GPUBindGroupLayoutEntry =>
            ({ binding, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } });
        const uniform = (binding: number): GPUBindGroupLayoutEntry =>
            ({ binding, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });

        // Everything fetches and compiles concurrently; any failure fails the pass.
        const [resolve, present] = await Promise.all([
            build(TEMPORAL_SHADER_PATH, 'temporal.wgsl', 'temporal-resolve', 'fs_main', TEMPORAL_HISTORY_FORMAT,
                [texture(0), texture(1), texture(2), sampler(3), uniform(4)]),
            build(RCAS_SHADER_PATH, 'upscale.wgsl', 'temporal-present', 'fs_rcas', presentationFormat,
                [texture(0), sampler(1), uniform(2)]),
            this.motion.init(),
        ]);
        if (this.disposed || !resolve || !present || !this.motion.isReady()) return;

        this.sampler = this.device.createSampler({
            label: 'temporal-sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this.uniformBuffer = createTrackedBuffer(this.device, {
            label: 'temporal-uniforms',
            size: TEMPORAL_UNIFORM_FLOAT_COUNT * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }, 'temporal-uniforms');
        this.rcasUniformBuffer = createTrackedBuffer(this.device, {
            label: 'temporal-present-uniforms',
            size: RCAS_UNIFORM_FLOAT_COUNT * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }, 'temporal-present-uniforms');
        this.peak = options.peak;
        this.sharpnessStops = options.sharpnessStops ?? TEMPORAL_RCAS_SHARPNESS_STOPS;
        this.presentationFormat = presentationFormat;
        this.present = present;
        // Last: `isReady()` turns true only for pipelines that passed validation.
        this.resolve = resolve;
    }

    public isReady(): boolean {
        return !this.disposed && this.resolve !== null;
    }

    /**
     * The road target for this frame — what the weather pass draws into
     * instead of the swap chain. Recreated when the size changes; undefined
     * before `init` has succeeded.
     */
    public ensureInput(width: number, height: number): GPUTextureView | undefined {
        if (!this.isReady() || !this.presentationFormat) return undefined;
        if (this.input?.width !== width || this.input?.height !== height) {
            destroyTracked(this.input?.texture);
            this.input = this.createTarget('temporal-input', this.presentationFormat, width, height);
            this.resolveGroups[0] = null;
            this.resolveGroups[1] = null;
        }
        return this.input.view;
    }

    /** This frame's motion, jitter and history decision. */
    public setFrame(state: TemporalFrameState): void {
        this.state = state;
    }

    /** Discard the history: the next resolve is this frame alone. */
    public resetHistory(): void {
        this.historyFresh = true;
    }

    /** Resolves encoded since boot (diagnostics, tests). */
    public getEncodeCount(): number {
        return this.encodes;
    }

    /** The motion field of the last encode, or null (DOF / rain streaks read it — slice 5). */
    public getMotionView(): GPUTextureView | null {
        return this.motion.getView();
    }

    /**
     * Encode the motion field, the resolve and the present into `outputView`
     * (the swap chain, or the split frame's present source). False — nothing
     * encoded — before `init`, before the weather pass had a road target, or
     * before `setFrame`.
     */
    public encode(
        encoder: GPUCommandEncoder,
        outputView: GPUTextureView,
        outputWidth: number,
        outputHeight: number,
        sceneDepth: GPUBindGroup,
        timing?: TemporalTimingContext,
    ): boolean {
        const input = this.input;
        const state = this.state;
        if (!this.isReady() || !input || !state) return false;
        const motionView = this.motion.ensureTarget(input.width, input.height);
        if (!motionView) return false;
        this.ensureHistories(outputWidth, outputHeight);
        if (motionView !== this.boundMotionView) {
            this.resolveGroups[0] = null;
            this.resolveGroups[1] = null;
            this.boundMotionView = motionView;
        }

        this.motion.writeUniforms(state.motionUniforms);
        this.motion.encode(encoder, sceneDepth);

        packTemporalUniforms({
            inputWidth: input.width,
            inputHeight: input.height,
            outputWidth,
            outputHeight,
            jitter: state.jitter,
            history: state.history && !this.historyFresh,
            peak: this.peak,
        }, this.uniforms);
        // The jitter moves every frame: one small write per frame.
        this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.uniforms);
        this.writeRcasUniforms(outputWidth, outputHeight);

        const readIndex = 1 - this.writeIndex;
        const writeIndex = this.writeIndex;
        const written = this.histories[writeIndex]!;
        this.resolveGroups[readIndex] ??= this.device.createBindGroup({
            label: `temporal-resolve-bind-group-${readIndex}`,
            layout: this.resolve!.layout,
            entries: [
                { binding: 0, resource: input.view },
                { binding: 1, resource: this.histories[readIndex]!.view },
                { binding: 2, resource: motionView },
                { binding: 3, resource: this.sampler! },
                { binding: 4, resource: { buffer: this.uniformBuffer! } },
            ],
        });
        this.presentGroups[writeIndex] ??= this.device.createBindGroup({
            label: `temporal-present-bind-group-${writeIndex}`,
            layout: this.present!.layout,
            entries: [
                { binding: 0, resource: written.view },
                { binding: 1, resource: this.sampler! },
                { binding: 2, resource: { buffer: this.rcasUniformBuffer! } },
            ],
        });

        this.drawPass(encoder, 'temporal-resolve', written.view, this.resolve!.pipeline,
            this.resolveGroups[readIndex], { r: 0, g: 0, b: 0, a: 0 }, timing, true, false);
        this.drawPass(encoder, 'temporal-present', outputView, this.present!.pipeline,
            this.presentGroups[writeIndex], { r: 0, g: 0, b: 0, a: 1 }, timing, false, true);

        this.writeIndex = readIndex;
        this.historyFresh = false;
        this.encodes += 1;
        return true;
    }

    public dispose(): void {
        this.disposed = true;
        this.motion.dispose();
        destroyTracked(this.input?.texture);
        for (const h of this.histories) destroyTracked(h?.texture);
        destroyTracked(this.uniformBuffer);
        destroyTracked(this.rcasUniformBuffer);
        this.input = null;
        this.histories[0] = null;
        this.histories[1] = null;
        this.resolveGroups[0] = null;
        this.resolveGroups[1] = null;
        this.presentGroups[0] = null;
        this.presentGroups[1] = null;
        this.boundMotionView = null;
        this.uniformBuffer = null;
        this.rcasUniformBuffer = null;
        this.rcasUniformsValid = false;
        this.resolve = null;
        this.present = null;
        this.sampler = null;
        this.state = null;
    }

    private ensureHistories(width: number, height: number): void {
        const current = this.histories[0];
        if (current?.width === width && current?.height === height) return;
        for (let i = 0; i < 2; i++) {
            destroyTracked(this.histories[i]?.texture);
            this.histories[i] = this.createTarget(`temporal-history-${i}`, TEMPORAL_HISTORY_FORMAT, width, height);
            this.resolveGroups[i] = null;
            this.presentGroups[i] = null;
        }
        this.historyFresh = true;
    }

    /** RCAS reads the history at output size: one `writeBuffer` when the size changes. */
    private writeRcasUniforms(width: number, height: number): void {
        packUpscaleUniforms({
            inputWidth: width,
            inputHeight: height,
            outputWidth: width,
            outputHeight: height,
            sharpnessStops: this.sharpnessStops,
            peak: this.peak,
        }, this.rcasUniforms);
        if (this.rcasUniformsValid && this.rcasUniforms.every((v, i) => v === this.rcasUploaded[i])) return;
        this.device.queue.writeBuffer(this.rcasUniformBuffer!, 0, this.rcasUniforms);
        this.rcasUploaded.set(this.rcasUniforms);
        this.rcasUniformsValid = true;
    }

    private drawPass(
        encoder: GPUCommandEncoder,
        label: string,
        view: GPUTextureView,
        pipeline: GPURenderPipeline,
        bindGroup: GPUBindGroup,
        clearValue: GPUColorDict,
        timing: TemporalTimingContext | undefined,
        opensSpan: boolean,
        closesSpan: boolean,
    ): void {
        const pass = encoder.beginRenderPass({
            label,
            colorAttachments: [{
                view,
                clearValue,
                loadOp: 'clear',
                storeOp: 'store',
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

    private createTarget(label: string, format: GPUTextureFormat, width: number, height: number): SizedTexture {
        const texture = createTrackedTexture(this.device, {
            label,
            size: [width, height],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        }, label);
        return { texture, view: texture.createView(), width, height };
    }
}
