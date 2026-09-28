import { getMemoryProfiler } from '../utils/memoryProfiler';
import { estimateTextureBytes, textureDescriptorExtent } from './gpuTextureBytes';

/**
 * Create/destroy wrappers that keep `MemoryProfiler`'s GPU counters in step
 * with the renderer's own allocations. Ids are keyed by object identity, so a
 * resize (destroy + create) swaps the entry instead of stacking a second one.
 */

type Tracked = { kind: 'texture' | 'buffer'; id: string };

const trackedIds = new WeakMap<object, Tracked>();
let nextId = 0;

export function createTrackedTexture(
    device: GPUDevice,
    desc: GPUTextureDescriptor,
    label: string,
): GPUTexture {
    const texture = device.createTexture(desc);
    const id = `${label}#${nextId++}`;
    trackedIds.set(texture, { kind: 'texture', id });
    getMemoryProfiler().trackGPUTexture(id, estimateTextureBytes(textureDescriptorExtent(desc)));
    return texture;
}

export function createTrackedBuffer(
    device: GPUDevice,
    desc: GPUBufferDescriptor,
    label: string,
): GPUBuffer {
    const buffer = device.createBuffer(desc);
    const id = `${label}#${nextId++}`;
    trackedIds.set(buffer, { kind: 'buffer', id });
    getMemoryProfiler().trackGPUBuffer(id, desc.size);
    return buffer;
}

/** Drop the counter entry for a resource made by `createTracked*`. Idempotent. */
export function untrackGpuResource(resource: GPUTexture | GPUBuffer | null | undefined): void {
    if (!resource) return;
    const entry = trackedIds.get(resource);
    if (!entry) return;
    trackedIds.delete(resource);
    const profiler = getMemoryProfiler();
    if (entry.kind === 'texture') profiler.untrackGPUTexture(entry.id);
    else profiler.untrackGPUBuffer(entry.id);
}

/** Untrack, then `destroy()`. Safe on null/undefined. */
export function destroyTracked(resource: GPUTexture | GPUBuffer | null | undefined): void {
    if (!resource) return;
    untrackGpuResource(resource);
    resource.destroy();
}
