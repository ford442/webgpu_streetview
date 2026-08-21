import type { LutVolume } from './lut';

export function createLutSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  });
}

/** WebGPU writeTexture bytesPerRow must be a multiple of 256. */
function alignedBytesPerRow(unpadded: number): number {
  return Math.ceil(unpadded / 256) * 256;
}

function padLutPixels(size: number, pixels: Uint8Array): { data: Uint8Array; bytesPerRow: number } {
  const rowBytes = size * 4;
  const bytesPerRow = alignedBytesPerRow(rowBytes);
  const data = new Uint8Array(bytesPerRow * size * size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      const src = (z * size * size + y * size) * 4;
      const dst = (z * size + y) * bytesPerRow;
      data.set(pixels.subarray(src, src + rowBytes), dst);
    }
  }
  return { data, bytesPerRow };
}

export function createIdentityLutTexture(device: GPUDevice): GPUTexture {
  const texture = device.createTexture({
    size: [1, 1, 1],
    dimension: '3d',
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const { data, bytesPerRow } = padLutPixels(1, new Uint8Array([0, 0, 0, 255]));
  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow, rowsPerImage: 1 },
    { width: 1, height: 1, depthOrArrayLayers: 1 },
  );
  return texture;
}

export function createLookLutTexture(device: GPUDevice, volume: LutVolume): GPUTexture {
  const { size, pixels } = volume;
  const texture = device.createTexture({
    size: [size, size, size],
    dimension: '3d',
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const { data, bytesPerRow } = padLutPixels(size, pixels);
  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow, rowsPerImage: size },
    { width: size, height: size, depthOrArrayLayers: size },
  );
  return texture;
}

export function createLutBindGroupLayout(
  device: GPUDevice,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility,
        texture: { sampleType: 'float', viewDimension: '3d' },
      },
      {
        binding: 1,
        visibility,
        sampler: { type: 'filtering' },
      },
    ],
  });
}

export function createLutBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  texture: GPUTexture,
  sampler: GPUSampler,
): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: texture.createView({ dimension: '3d' }) },
      { binding: 1, resource: sampler },
    ],
  });
}
