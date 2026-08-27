import { PARTICLE_DENSITY_SCALE, PARTICLE_MAX_DT } from '../weatherParticles';
import { WeatherParamIndex } from '../weatherUniformLayout';
import { PARTICLE_UNIFORMS_BYTE_SIZE, WORKGROUP_SIZE } from './constants';

/**
 * GPU precipitation for the compute weather path (`weather-particles.wgsl`).
 *
 * Owns the compact particle-state ping-pong pair, the half-res density splat
 * target, and the three compute pipelines that advance them. The weather pass
 * consumes the results through bindings 7 (density, read) and 8 (state, write).
 *
 * Everything here degrades to inert: if the particle shader is missing, the
 * pipelines stay null and `dispatch()` returns false forever, which leaves the
 * weather shader reading the 1x1 dummies and falling back to its procedural
 * precipitation.
 */
export class ComputeWeatherParticles {
    private states: [GPUTexture | null, GPUTexture | null] = [null, null];
    private readIndex: 0 | 1 = 0;
    private writeIndex: 1 | 0 = 1;
    private gridWidth = 0;
    private gridHeight = 0;

    private density: GPUTexture | null = null;
    private densityWidth = 0;
    private densityHeight = 0;

    private enabled = false;
    private lastParticleTime = 0;

    private uniformsBuffer: GPUBuffer | null = null;
    private bindGroupLayout: GPUBindGroupLayout | null = null;
    private integratePipeline: GPUComputePipeline | null = null;
    private clearDensityPipeline: GPUComputePipeline | null = null;
    private splatPipeline: GPUComputePipeline | null = null;

    constructor(private readonly device: GPUDevice) {
        this.uniformsBuffer = device.createBuffer({
            size: PARTICLE_UNIFORMS_BYTE_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Compile the three particle pipelines. A missing or unreadable shader is
     * a soft failure: GPU precipitation stays off and the caller carries on.
     */
    public async initPipelines(shaderUrl: string): Promise<void> {
        let shaderCode: string;
        try {
            const response = await fetch(shaderUrl);
            if (!response.ok) {
                console.warn(`[Renderer] Particle shader missing (${response.status}); GPU precipitation disabled`);
                return;
            }
            shaderCode = await response.text();
        } catch (error) {
            console.warn('[Renderer] Failed to load weather-particles.wgsl; GPU precipitation disabled', error);
            return;
        }

        const module = this.device.createShaderModule({ code: shaderCode });
        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });
        const layout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout],
        });
        this.integratePipeline = this.device.createComputePipeline({
            layout,
            compute: { module, entryPoint: 'integrate' },
        });
        this.clearDensityPipeline = this.device.createComputePipeline({
            layout,
            compute: { module, entryPoint: 'clear_density' },
        });
        this.splatPipeline = this.device.createComputePipeline({
            layout,
            compute: { module, entryPoint: 'splat' },
        });
    }

    /** Half-res splat target, sized from the full-res write texture. */
    public ensureDensityTexture(writeWidth: number, writeHeight: number): void {
        const width = Math.max(1, Math.ceil(writeWidth * PARTICLE_DENSITY_SCALE));
        const height = Math.max(1, Math.ceil(writeHeight * PARTICLE_DENSITY_SCALE));
        if (this.density && this.densityWidth === width && this.densityHeight === height) {
            return;
        }
        if (this.density) this.density.destroy();
        this.densityWidth = width;
        this.densityHeight = height;
        this.density = this.device.createTexture({
            size: [width, height],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    private ensureStateTextures(gridW: number, gridH: number): void {
        if (
            this.states[0]
            && this.states[1]
            && this.gridWidth === gridW
            && this.gridHeight === gridH
        ) {
            return;
        }
        for (let i = 0; i < 2; i++) {
            if (this.states[i]) this.states[i]!.destroy();
            this.states[i] = null;
        }
        this.gridWidth = gridW;
        this.gridHeight = gridH;
        const usage = GPUTextureUsage.STORAGE_BINDING
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_DST;
        this.states[0] = this.device.createTexture({ size: [gridW, gridH], format: 'rgba32float', usage });
        this.states[1] = this.device.createTexture({ size: [gridW, gridH], format: 'rgba32float', usage });
        this.readIndex = 0;
        this.writeIndex = 1;
    }

    /**
     * Upload WASM particle seeds (4 floats/particle) into the compact state
     * textures, enabling bindings 7/8 for subsequent dispatches. Both halves of
     * the ping-pong are written so the very first read is initialised.
     *
     * @returns true when the seeds were accepted.
     */
    public uploadSeeds(seeds: Float32Array, width: number, height: number, time: number): boolean {
        if (width < 1 || height < 1) return false;
        if (seeds.length < width * height * 4) return false;
        this.ensureStateTextures(width, height);
        const read = this.states[0];
        const write = this.states[1];
        if (!read || !write) return false;
        const bytesPerRow = width * 16;
        const layout = { bytesPerRow, rowsPerImage: height };
        const size = { width, height };
        this.device.queue.writeTexture({ texture: read }, seeds, layout, size);
        this.device.queue.writeTexture({ texture: write }, seeds, layout, size);
        this.enabled = true;
        this.lastParticleTime = time;
        return true;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    /** True when bindings 7/8 are the real particle textures (not 1x1 dummies). */
    public isActive(): boolean {
        return this.enabled
            && this.gridWidth > 1
            && this.gridHeight > 1
            && this.densityWidth > 1
            && this.densityHeight > 1;
    }

    /** Binding 7 — the density splat, or the caller's dummy while inactive. */
    public getDensityView(dummy: GPUTexture): GPUTextureView {
        if (this.enabled && this.density) {
            return this.density.createView();
        }
        return dummy.createView();
    }

    /** Binding 8 — the state write target, or the caller's dummy while inactive. */
    public getStateWriteView(dummy: GPUTexture): GPUTextureView {
        const write = this.states[this.writeIndex];
        if (this.enabled && write) {
            return write.createView();
        }
        return dummy.createView();
    }

    public swapIfActive(): void {
        if (!this.enabled) return;
        const nextRead = this.writeIndex;
        this.writeIndex = this.readIndex;
        this.readIndex = nextRead;
    }

    /**
     * Record clear_density -> integrate -> splat. Returns false (recording
     * nothing) when particles are off, unseeded, or there is no precipitation
     * to simulate.
     */
    public dispatch(
        commandEncoder: GPUCommandEncoder,
        extraBuffer: GPUBuffer | null,
        weatherParams: Float32Array,
        writeWidth: number,
        writeHeight: number,
    ): boolean {
        const read = this.states[this.readIndex];
        const write = this.states[this.writeIndex];
        if (
            !this.enabled
            || !read
            || !write
            || !this.density
            || !extraBuffer
            || !this.uniformsBuffer
            || !this.bindGroupLayout
            || !this.integratePipeline
            || !this.clearDensityPipeline
            || !this.splatPipeline
        ) {
            return false;
        }

        const precip =
            (weatherParams[WeatherParamIndex.rainIntensity] ?? 0)
            + (weatherParams[WeatherParamIndex.snowIntensity] ?? 0);
        if (precip < 0.001) return false;

        const time = weatherParams[WeatherParamIndex.time] ?? 0;
        let dt = time - this.lastParticleTime;
        if (dt < 0) dt = 0;
        dt = Math.min(dt, PARTICLE_MAX_DT);
        this.lastParticleTime = time;

        this.ensureDensityTexture(writeWidth, writeHeight);
        if (!this.density) return false;

        const uniforms = new Float32Array([
            dt,
            this.gridWidth,
            this.gridHeight,
            0,
            this.densityWidth,
            this.densityHeight,
            0,
            0,
        ]);
        this.device.queue.writeBuffer(this.uniformsBuffer, 0, uniforms);

        const makeGroup = (src: GPUTexture, dst: GPUTexture): GPUBindGroup =>
            this.device.createBindGroup({
                layout: this.bindGroupLayout!,
                entries: [
                    { binding: 0, resource: src.createView() },
                    { binding: 1, resource: dst.createView() },
                    { binding: 2, resource: { buffer: extraBuffer } },
                    { binding: 3, resource: { buffer: this.uniformsBuffer! } },
                ],
            });

        const clearGroup = makeGroup(read, this.density);
        const integrateGroup = makeGroup(read, write);
        const splatGroup = makeGroup(write, this.density);

        const gridX = Math.ceil(this.gridWidth / WORKGROUP_SIZE);
        const gridY = Math.ceil(this.gridHeight / WORKGROUP_SIZE);
        const densX = Math.ceil(this.densityWidth / WORKGROUP_SIZE);
        const densY = Math.ceil(this.densityHeight / WORKGROUP_SIZE);

        const clearPass = commandEncoder.beginComputePass();
        clearPass.setPipeline(this.clearDensityPipeline);
        clearPass.setBindGroup(0, clearGroup);
        clearPass.dispatchWorkgroups(densX, densY);
        clearPass.end();

        const integratePass = commandEncoder.beginComputePass();
        integratePass.setPipeline(this.integratePipeline);
        integratePass.setBindGroup(0, integrateGroup);
        integratePass.dispatchWorkgroups(gridX, gridY);
        integratePass.end();

        const splatPass = commandEncoder.beginComputePass();
        splatPass.setPipeline(this.splatPipeline);
        splatPass.setBindGroup(0, splatGroup);
        splatPass.dispatchWorkgroups(gridX, gridY);
        splatPass.end();
        return true;
    }

    public dispose(): void {
        try {
            for (let i = 0; i < 2; i++) {
                if (this.states[i]) this.states[i]!.destroy();
            }
            if (this.density) this.density.destroy();
            if (this.uniformsBuffer) this.uniformsBuffer.destroy();
        } catch {
            // ignore cleanup errors
        }
        this.states = [null, null];
        this.density = null;
        this.uniformsBuffer = null;
        this.bindGroupLayout = null;
        this.integratePipeline = null;
        this.clearDensityPipeline = null;
        this.splatPipeline = null;
        this.enabled = false;
    }
}
