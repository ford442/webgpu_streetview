/**
 * The motion-field pass (#360 slice 1): `motion.wgsl` into an `rg16float`
 * texture at the intermediate's size, from this frame's `MotionUniforms`
 * (`motionMath.packMotionUniforms`) and the shared scene-depth group (the
 * release dolly's nearness).
 *
 * Owns its own 112-byte uniform buffer (never weather slots), one pipeline
 * built through `gpuPipelineFactory` (a WGSL error rejects `init` instead of
 * yielding an invalid pipeline) and the field texture, recreated when the
 * intermediate's size changes. Holds no texture until the first `ensureTarget`.
 *
 * Its consumers — the temporal resolve (slice 2), DOF and rain streaks (slice
 * 4) — read `getView()` after `encode`; the history-validity decision that
 * says whether they may is `motionMath.TemporalHistoryTracker`, on the CPU.
 */
import { PUBLIC_URL } from '../../config/publicUrl';
import {
    createRenderPipelineChecked,
    createShaderModuleChecked,
    fetchShaderSource,
} from '../gpuPipelineFactory';
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';
import { getSceneDepthBindGroupLayout } from '../depth/sceneDepthBinding';
import { MOTION_FORMAT, MOTION_UNIFORM_FLOAT_COUNT } from './motionMath';

const MOTION_SHADER_PATH = 'shaders/motion.wgsl';

interface SizedTexture {
    texture: GPUTexture;
    view: GPUTextureView;
    width: number;
    height: number;
}

export class MotionVectorPass {
    private pipeline: GPURenderPipeline | null = null;
    private bindGroup: GPUBindGroup | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private target: SizedTexture | null = null;

    private readonly uploaded = new Float32Array(MOTION_UNIFORM_FLOAT_COUNT);
    private uniformsValid = false;
    private disposed = false;

    constructor(private readonly device: GPUDevice) {}

    public async init(): Promise<void> {
        const url = `${PUBLIC_URL}/${MOTION_SHADER_PATH}`;
        const code = await fetchShaderSource(url, 'motion.wgsl');
        if (this.disposed) return;
        const module = await createShaderModuleChecked(this.device, { label: 'motion.wgsl', code });

        const layout = this.device.createBindGroupLayout({
            label: 'motion-bind-group-layout',
            entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
        });
        const pipelineLayout = this.device.createPipelineLayout({
            label: 'motion-pipeline-layout',
            bindGroupLayouts: [layout, getSceneDepthBindGroupLayout(this.device)],
        });
        const pipeline = await createRenderPipelineChecked(this.device, {
            label: 'motion-pipeline',
            layout: pipelineLayout,
            vertex: { module, entryPoint: 'vs_main' },
            fragment: { module, entryPoint: 'fs_main', targets: [{ format: MOTION_FORMAT }] },
            primitive: { topology: 'triangle-list' },
        });
        if (this.disposed) return;

        const uniformBuffer = createTrackedBuffer(this.device, {
            label: 'motion-uniforms',
            size: MOTION_UNIFORM_FLOAT_COUNT * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }, 'motion-uniforms');
        this.uniformBuffer = uniformBuffer;
        this.bindGroup = this.device.createBindGroup({
            label: 'motion-bind-group',
            layout,
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
        });
        // Last: `isReady()` turns true only for a pipeline that passed validation.
        this.pipeline = pipeline;
    }

    public isReady(): boolean {
        return !this.disposed && this.pipeline !== null;
    }

    /** The field for this frame, at the intermediate's size. Undefined before `init` has succeeded. */
    public ensureTarget(width: number, height: number): GPUTextureView | undefined {
        if (!this.isReady()) return undefined;
        if (this.target?.width !== width || this.target?.height !== height) {
            destroyTracked(this.target?.texture);
            const texture = createTrackedTexture(this.device, {
                label: 'motion-field',
                size: [width, height],
                format: MOTION_FORMAT,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            }, 'motion-field');
            this.target = { texture, view: texture.createView(), width, height };
        }
        return this.target.view;
    }

    /** The field the last `encode` wrote, or null before one. */
    public getView(): GPUTextureView | null {
        return this.target?.view ?? null;
    }

    /** One `writeBuffer` when the uniforms changed, none on a steady frame. */
    public writeUniforms(uniforms: Float32Array<ArrayBuffer>): void {
        if (!this.uniformBuffer) return;
        if (this.uniformsValid && uniforms.every((v, i) => v === this.uploaded[i])) return;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
        this.uploaded.set(uniforms);
        this.uniformsValid = true;
    }

    /**
     * Encode the field into the target `ensureTarget` sized. False — nothing
     * encoded — before `init`, or before a target exists.
     */
    public encode(encoder: GPUCommandEncoder, sceneDepth: GPUBindGroup): boolean {
        const target = this.target;
        if (!this.isReady() || !target || !this.bindGroup) return false;
        const pass = encoder.beginRenderPass({
            label: 'motion',
            colorAttachments: [{
                view: target.view,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        });
        pass.setPipeline(this.pipeline!);
        pass.setBindGroup(0, this.bindGroup);
        pass.setBindGroup(1, sceneDepth);
        pass.draw(3, 1, 0, 0);
        pass.end();
        return true;
    }

    public dispose(): void {
        this.disposed = true;
        destroyTracked(this.target?.texture);
        destroyTracked(this.uniformBuffer);
        this.target = null;
        this.uniformBuffer = null;
        this.bindGroup = null;
        this.pipeline = null;
        this.uniformsValid = false;
    }
}
