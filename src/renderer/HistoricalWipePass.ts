import { createTrackedBuffer, destroyTracked } from './gpuMemoryTracking';
import {
    packWipeUniforms,
    WIPE_UNIFORM_FLOAT_COUNT,
    type WipeDirection,
} from './historicalWipe';

export const HISTORICAL_WIPE_SHADER_PATH = 'shaders/historical-wipe.wgsl';

export async function loadHistoricalWipeShader(): Promise<string> {
    const url = `${process.env.PUBLIC_URL || '/'}/${HISTORICAL_WIPE_SHADER_PATH}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Failed to load historical-wipe.wgsl: ${response.status} ${response.statusText}`,
        );
    }
    return response.text();
}

/**
 * The year-chip wipe — its own small pipeline, drawn over pass 1 into the HDR
 * intermediate (`loadOp: 'load'`) so weather, the windshield portal and the
 * cabin composite all see one frame.
 *
 * **Hold-pause**: the only texture this pass is ever handed is the hold-pause
 * snapshot (`TransitionManager.previousFrame`). It has no upload path and no
 * reference to the live Maps canvas; the "after" half of the frame is whatever
 * pass 1 drew, and `Renderer` does not encode this pass while a hold is active.
 *
 * Independent of `?legacyTransitions` — it never enables the zoom-blur set.
 */
export class HistoricalWipePass {
    private pipeline: GPURenderPipeline | null = null;
    private bindGroupLayout: GPUBindGroupLayout | null = null;
    private sampler: GPUSampler | null = null;
    private uniformBuffer: GPUBuffer | null = null;

    /** Cached per before-texture identity — a new hold snapshot rebinds. */
    private boundBefore: GPUTexture | null = null;
    private bindGroup: GPUBindGroup | null = null;

    private active = false;
    private direction: WipeDirection = 1;
    private progress = 0;
    private disposed = false;

    constructor(private readonly device: GPUDevice) {}

    /** A failure is never fatal: the hop falls back to the shader crossfade. */
    public async init(intermediateFormat: GPUTextureFormat): Promise<void> {
        const code = await loadHistoricalWipeShader();
        if (this.disposed) return;
        const module = this.device.createShaderModule({ label: 'Historical wipe', code });
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Historical wipe bind group layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ],
        });
        this.uniformBuffer = createTrackedBuffer(this.device, {
            label: 'Historical wipe uniforms',
            size: WIPE_UNIFORM_FLOAT_COUNT * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }, 'historical-wipe-uniforms');
        this.pipeline = this.device.createRenderPipeline({
            label: 'Historical wipe pipeline',
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
            vertex: { module, entryPoint: 'vs_main' },
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{ format: intermediateFormat }],
            },
            primitive: { topology: 'triangle-strip' },
        });
    }

    public isReady(): boolean {
        return !this.disposed && !!this.pipeline && !!this.uniformBuffer;
    }

    public isActive(): boolean {
        return this.active && this.isReady();
    }

    /** Arm the wipe at progress 0. False when the pipeline never built. */
    public begin(direction: WipeDirection): boolean {
        if (!this.isReady()) return false;
        this.active = true;
        this.direction = direction;
        this.setProgress(0);
        return true;
    }

    public setProgress(progress: number): void {
        if (!this.isReady()) return;
        this.progress = progress;
        this.device.queue.writeBuffer(
            this.uniformBuffer!,
            0,
            packWipeUniforms(this.progress, this.direction),
        );
    }

    public end(): void {
        this.active = false;
        this.progress = 0;
    }

    /**
     * Paint the unswept part of the held frame over `targetView`, which pass 1
     * has already drawn this frame. Returns false (and encodes nothing) when
     * there is no active wipe or no snapshot to wipe from.
     */
    public encode(
        commandEncoder: GPUCommandEncoder,
        targetView: GPUTextureView,
        before: GPUTexture | undefined,
    ): boolean {
        if (!this.isActive() || !before || this.progress >= 1) return false;
        if (this.boundBefore !== before || !this.bindGroup) {
            this.bindGroup = this.device.createBindGroup({
                label: 'Historical wipe bind group',
                layout: this.bindGroupLayout!,
                entries: [
                    { binding: 0, resource: this.sampler! },
                    { binding: 1, resource: before.createView() },
                    { binding: 2, resource: { buffer: this.uniformBuffer! } },
                ],
            });
            this.boundBefore = before;
        }
        const pass = commandEncoder.beginRenderPass({
            label: 'Historical wipe',
            colorAttachments: [{
                view: targetView,
                loadOp: 'load' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        });
        pass.setPipeline(this.pipeline!);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(4, 1, 0, 0);
        pass.end();
        return true;
    }

    public dispose(): void {
        this.disposed = true;
        this.active = false;
        destroyTracked(this.uniformBuffer);
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;
        this.boundBefore = null;
    }
}
