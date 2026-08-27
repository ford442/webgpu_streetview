import type { LutVolume } from '../lut';
import {
    createIdentityLutTexture,
    createLookLutTexture,
    createLutBindGroup,
    createLutBindGroupLayout,
    createLutSampler,
} from '../lutGpu';

/**
 * Look-LUT state for the compute weather pass (bind group 1).
 *
 * Owns the swap between an uploaded 3D look volume and the identity texture
 * that stands in for "no grade". Kept separate because the LUT has its own
 * lifecycle — the texture is replaced whenever the look changes, while the
 * sampler and layout live for the life of the device.
 */
export class ComputeWeatherLut {
    private sampler: GPUSampler | null = null;
    private dummyTexture: GPUTexture | null = null;
    private texture: GPUTexture | null = null;
    private layout: GPUBindGroupLayout | null = null;
    private bindGroup: GPUBindGroup | null = null;

    constructor(private readonly device: GPUDevice) {
        this.sampler = createLutSampler(device);
        this.dummyTexture = createIdentityLutTexture(device);
        this.texture = this.dummyTexture;
    }

    /** Create the bind group layout. Returns it for the pipeline layout. */
    public createLayout(): GPUBindGroupLayout {
        this.layout = createLutBindGroupLayout(this.device, GPUShaderStage.COMPUTE);
        return this.layout;
    }

    public rebuild(): void {
        if (!this.layout || !this.sampler || !this.texture) return;
        this.bindGroup = createLutBindGroup(this.device, this.layout, this.texture, this.sampler);
    }

    public getBindGroup(): GPUBindGroup | null {
        return this.bindGroup;
    }

    /** Swap in a look volume, or `null` to fall back to the identity LUT. */
    public setVolume(volume: LutVolume | null): void {
        if (this.texture && this.texture !== this.dummyTexture) {
            this.texture.destroy();
        }
        this.texture = volume
            ? createLookLutTexture(this.device, volume)
            : this.dummyTexture;
        this.rebuild();
    }

    public dispose(): void {
        try {
            if (this.texture && this.texture !== this.dummyTexture) this.texture.destroy();
            if (this.dummyTexture) this.dummyTexture.destroy();
        } catch {
            // ignore cleanup errors
        }
        this.texture = null;
        this.dummyTexture = null;
        this.bindGroup = null;
        this.layout = null;
        this.sampler = null;
    }
}
