/**
 * Byte-size estimates for GPU allocations, fed to the Memory Stats overlay.
 * Estimates only — drivers pad rows and align allocations — but stable enough
 * that growth across hops/resizes means a real leak.
 */

const BYTES_PER_TEXEL: Partial<Record<GPUTextureFormat, number>> = {
    r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1,
    r16float: 2, r16uint: 2, r16sint: 2, rg8unorm: 2, rg8snorm: 2, rg8uint: 2, rg8sint: 2,
    depth16unorm: 2, stencil8: 1,
    r32float: 4, r32uint: 4, r32sint: 4, rg16float: 4, rg16uint: 4, rg16sint: 4,
    rgba8unorm: 4, 'rgba8unorm-srgb': 4, rgba8snorm: 4, rgba8uint: 4, rgba8sint: 4,
    bgra8unorm: 4, 'bgra8unorm-srgb': 4, rgb10a2unorm: 4, rgb10a2uint: 4,
    rg11b10ufloat: 4, rgb9e5ufloat: 4,
    depth24plus: 4, 'depth24plus-stencil8': 4, depth32float: 4,
    'depth32float-stencil8': 5,
    rg32float: 8, rg32uint: 8, rg32sint: 8, rgba16float: 8, rgba16uint: 8, rgba16sint: 8,
    rgba32float: 16, rgba32uint: 16, rgba32sint: 16,
};

/** Bytes per texel for uncompressed formats; 4 for anything not listed. */
export function bytesPerTexel(format: GPUTextureFormat): number {
    return BYTES_PER_TEXEL[format] ?? 4;
}

export interface TextureExtent {
    width: number;
    height?: number;
    depthOrArrayLayers?: number;
    format: GPUTextureFormat;
    mipLevelCount?: number;
    sampleCount?: number;
}

/** width × height × bpp × layers × samples, summed over the mip chain. */
export function estimateTextureBytes(t: TextureExtent): number {
    const layers = Math.max(1, t.depthOrArrayLayers ?? 1);
    const samples = Math.max(1, t.sampleCount ?? 1);
    const mips = Math.max(1, t.mipLevelCount ?? 1);
    const bpp = bytesPerTexel(t.format);
    let w = Math.max(1, t.width);
    let h = Math.max(1, t.height ?? 1);
    let total = 0;
    for (let i = 0; i < mips; i++) {
        total += w * h;
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
    }
    return total * bpp * layers * samples;
}

/** Normalise a `GPUTextureDescriptor` into a `TextureExtent`. */
export function textureDescriptorExtent(desc: GPUTextureDescriptor): TextureExtent {
    const size = desc.size;
    let width: number;
    let height: number | undefined;
    let layers: number | undefined;
    if (Array.isArray(size) || (typeof size === 'object' && Symbol.iterator in size)) {
        const dims = Array.from(size as Iterable<number>);
        width = dims[0] ?? 1;
        height = dims[1];
        layers = dims[2];
    } else {
        const dict = size as GPUExtent3DDict;
        width = dict.width;
        height = dict.height;
        layers = dict.depthOrArrayLayers;
    }
    return {
        width,
        height,
        depthOrArrayLayers: layers,
        format: desc.format,
        mipLevelCount: desc.mipLevelCount,
        sampleCount: desc.sampleCount,
    };
}
