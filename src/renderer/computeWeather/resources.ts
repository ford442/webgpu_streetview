import {
    COMPUTE_UNIFORMS_BYTE_SIZE,
    NOISE_BUFFER_BYTES,
} from './constants';
import { WEATHER_PARAMS_BYTE_SIZE } from '../weatherUniformLayout';

/**
 * Device-lifetime GPU resources for the compute weather pass: samplers, the
 * shared parameter buffers, the 1x1 dummies that fill unused
 * image_video_effects slots, and the size-dependent write / depth / colour
 * history textures.
 *
 * Owns nothing about *what* is rendered — it just holds the surfaces and knows
 * when they have to be reallocated. Particle-specific surfaces live in
 * `./particles.ts`.
 */
export class ComputeWeatherResources {
    public filteringSampler: GPUSampler | null = null;
    public nonFilteringSampler: GPUSampler | null = null;
    public comparisonSampler: GPUSampler | null = null;

    // Dummy 1x1 resources for unused image_video_effects slots. Binding 9
    // (dataTextureC) stays a dummy unless temporal history is on. Bindings 7/8
    // start as dummies and are replaced by real particle textures after
    // updateParticleSeeds().
    public dummyDataTextureA: GPUTexture | null = null;
    public dummyDataTextureB: GPUTexture | null = null;
    public dummyDataTextureC: GPUTexture | null = null;

    public extraBuffer: GPUBuffer | null = null;
    public computeUniformsBuffer: GPUBuffer | null = null;
    public noiseBuffer: GPUBuffer | null = null;

    public writeTexture: GPUTexture | null = null;
    public writeWidth = 0;
    public writeHeight = 0;

    /** Full-res r32float view-depth proxy — ping-pong pair for temporal fog (binding 4 read / 6 write). */
    private depthTextures: [GPUTexture | null, GPUTexture | null] = [null, null];
    private depthReadIndex: 0 | 1 = 0;
    private depthWriteIndex: 1 | 0 = 1;

    public colorHistoryTexture: GPUTexture | null = null;
    public historyReady = false;

    constructor(private readonly device: GPUDevice) {
        this.filteringSampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this.nonFilteringSampler = device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
        });
        this.comparisonSampler = device.createSampler({
            compare: 'less',
        });

        this.extraBuffer = device.createBuffer({
            size: WEATHER_PARAMS_BYTE_SIZE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.computeUniformsBuffer = device.createBuffer({
            size: COMPUTE_UNIFORMS_BYTE_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.noiseBuffer = device.createBuffer({
            size: NOISE_BUFFER_BYTES,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.dummyDataTextureC = device.createTexture({
            size: [1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING,
        });
        // Binding 7 is a readable rgba32float (density). Binding 8 is a
        // write-only storage texture (particle state).
        this.dummyDataTextureA = device.createTexture({
            size: [1, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING,
        });
        this.dummyDataTextureB = device.createTexture({
            size: [1, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING,
        });
    }

    /** True once every device-lifetime resource a bind group needs exists. */
    public isReady(): boolean {
        return !!(
            this.extraBuffer
            && this.computeUniformsBuffer
            && this.noiseBuffer
            && this.filteringSampler
            && this.nonFilteringSampler
            && this.comparisonSampler
            && this.dummyDataTextureA
            && this.dummyDataTextureB
            && this.dummyDataTextureC
        );
    }

    /**
     * (Re)allocate the size-dependent surfaces. No-op when the dimensions are
     * unchanged, so this is safe to call every frame.
     *
     * @returns true when a reallocation happened.
     */
    public ensureWriteTexture(width: number, height: number): boolean {
        if (this.writeTexture && this.writeWidth === width && this.writeHeight === height) {
            return false;
        }
        if (this.writeTexture) this.writeTexture.destroy();
        for (let i = 0; i < 2; i++) {
            if (this.depthTextures[i]) this.depthTextures[i]!.destroy();
            this.depthTextures[i] = null;
        }

        this.writeWidth = width;
        this.writeHeight = height;
        const size: [number, number] = [Math.max(1, width), Math.max(1, height)];
        this.writeTexture = this.device.createTexture({
            size,
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        if (this.colorHistoryTexture) this.colorHistoryTexture.destroy();
        this.colorHistoryTexture = this.device.createTexture({
            size,
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.historyReady = false;
        const depthUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
        this.depthTextures[0] = this.device.createTexture({ size, format: 'r32float', usage: depthUsage });
        this.depthTextures[1] = this.device.createTexture({ size, format: 'r32float', usage: depthUsage });
        this.depthReadIndex = 0;
        this.depthWriteIndex = 1;
        return true;
    }

    public getDepthReadTexture(): GPUTexture | null {
        return this.depthTextures[this.depthReadIndex];
    }

    public getDepthWriteTexture(): GPUTexture | null {
        return this.depthTextures[this.depthWriteIndex];
    }

    public swapDepthPingPong(): void {
        const nextRead = this.depthWriteIndex;
        this.depthWriteIndex = this.depthReadIndex;
        this.depthReadIndex = nextRead;
    }

    /**
     * Binding 9: the previous frame's colour, or the 1x1 dummy until temporal
     * history is both enabled and primed by a completed copy.
     */
    public getColorHistoryView(temporalHistoryEnabled: boolean): GPUTextureView {
        if (temporalHistoryEnabled && this.historyReady && this.colorHistoryTexture) {
            return this.colorHistoryTexture.createView();
        }
        return this.dummyDataTextureC!.createView();
    }

    public dispose(): void {
        try {
            if (this.extraBuffer) this.extraBuffer.destroy();
            if (this.computeUniformsBuffer) this.computeUniformsBuffer.destroy();
            if (this.noiseBuffer) this.noiseBuffer.destroy();
            if (this.writeTexture) this.writeTexture.destroy();
            if (this.colorHistoryTexture) this.colorHistoryTexture.destroy();
            for (let i = 0; i < 2; i++) {
                if (this.depthTextures[i]) this.depthTextures[i]!.destroy();
            }
            if (this.dummyDataTextureA) this.dummyDataTextureA.destroy();
            if (this.dummyDataTextureB) this.dummyDataTextureB.destroy();
            if (this.dummyDataTextureC) this.dummyDataTextureC.destroy();
        } catch {
            // ignore cleanup errors
        }
        this.extraBuffer = null;
        this.computeUniformsBuffer = null;
        this.noiseBuffer = null;
        this.writeTexture = null;
        this.colorHistoryTexture = null;
        this.historyReady = false;
        this.depthTextures = [null, null];
        this.filteringSampler = null;
        this.nonFilteringSampler = null;
        this.comparisonSampler = null;
        this.dummyDataTextureA = null;
        this.dummyDataTextureB = null;
        this.dummyDataTextureC = null;
    }
}
