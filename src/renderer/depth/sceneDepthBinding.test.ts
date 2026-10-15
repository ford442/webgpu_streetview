import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeGpu, installGpuGlobals, type FakeGpu } from '../computeWeather/__tests__/fakeGpu';
import {
    getSceneDepthBindGroupLayout,
    getSceneDepthFallback,
    releaseSceneDepthFallback,
    resolveSceneDepthBindGroup,
    SCENE_DEPTH_FORMAT,
    SCENE_DEPTH_PARAMS_BYTE_SIZE,
    SCENE_DEPTH_PARAMS_FLOAT_COUNT,
    SceneDepthParamIndex,
    STREETVIEW_SCENE_DEPTH_GROUP,
    WEATHER_SCENE_DEPTH_GROUP,
    type AuxDepth,
} from './sceneDepthBinding';

const shaderDir = join(__dirname, '..', '..', '..', 'public', 'shaders');
const read = (name: string) => readFileSync(join(shaderDir, name), 'utf8');

/** Field names of `struct SceneDepthParams { ... }`, in declaration order. */
function structFields(source: string): string[] {
    const start = source.indexOf('struct SceneDepthParams');
    const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start));
    return body
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').trim())
        .filter(Boolean)
        .map((line) => {
            const m = /^(\w+)\s*:\s*f32,?$/.exec(line);
            if (!m) throw new Error(`unexpected SceneDepthParams member: ${line}`);
            return m[1]!;
        });
}

const SHADERS = [
    ['streetview.wgsl', STREETVIEW_SCENE_DEPTH_GROUP],
    ['weather-post.wgsl', WEATHER_SCENE_DEPTH_GROUP],
    ['weather-post-compute.wgsl', WEATHER_SCENE_DEPTH_GROUP],
] as const;

describe('SceneDepthParams — one layout in TS and every WGSL consumer', () => {
    it.each(SHADERS)('%s declares the fields at the indices SceneDepthParamIndex names', (name) => {
        const fields = structFields(read(name));
        expect(fields).toHaveLength(SCENE_DEPTH_PARAMS_FLOAT_COUNT);
        for (const [field, index] of Object.entries(SceneDepthParamIndex)) {
            expect(fields[index], field).toBe(field);
        }
        // All f32, so the byte size is just the count — and a 16-byte multiple.
        expect(SCENE_DEPTH_PARAMS_BYTE_SIZE % 16).toBe(0);
    });

    it.each(SHADERS)('%s binds texture, sampler, params at the group the renderer sets', (name, group) => {
        const source = read(name);
        expect(source).toContain(`@group(${group}) @binding(0) var sceneDepthTex: texture_2d<f32>;`);
        expect(source).toContain(`@group(${group}) @binding(1) var sceneDepthSampler: sampler;`);
        expect(source).toContain(`@group(${group}) @binding(2) var<uniform> depthParams: SceneDepthParams;`);
    });
});

describe('the scene-depth layout and fallback', () => {
    let gpu: FakeGpu;
    beforeEach(() => {
        installGpuGlobals();
        gpu = createFakeGpu();
    });

    it('builds one layout per device: filterable texture, filtering sampler, uniform', () => {
        const a = getSceneDepthBindGroupLayout(gpu.device);
        expect(getSceneDepthBindGroupLayout(gpu.device)).toBe(a);
        const entries = gpu.bindGroupLayouts.find((l) => l === (a as unknown))!.entries;
        expect(entries.map((e) => e.binding)).toEqual([0, 1, 2]);
        expect(entries[0]!.texture?.sampleType).toBe('float');
        expect(entries[1]!.sampler?.type).toBe('filtering');
        expect(entries[2]!.buffer?.type).toBe('uniform');
        expect(getSceneDepthBindGroupLayout(createFakeGpu().device)).not.toBe(a);
    });

    it('the fallback is a 1×1 depth texture and a zero-initialised (blend 0, dolly 0) params block', () => {
        const group = getSceneDepthFallback(gpu.device);
        expect(getSceneDepthFallback(gpu.device)).toBe(group);
        const texture = gpu.textures.find((t) => t.descriptor.label === 'scene-depth-fallback')!;
        expect(texture.descriptor.size).toEqual([1, 1]);
        expect(texture.descriptor.format).toBe(SCENE_DEPTH_FORMAT);
        const params = gpu.buffers.find((b) => b.descriptor.label === 'scene-depth-fallback-params')!;
        expect(params.descriptor.size).toBe(SCENE_DEPTH_PARAMS_BYTE_SIZE);
        // Never written: WebGPU zero-initialises buffers, which is exactly "no depth".
        expect(gpu.writeBufferCalls.filter((c) => c.buffer === params)).toHaveLength(0);
    });

    it('resolves the published depth when there is one, else the fallback', () => {
        const published = { bindGroup: { kind: 'published' } } as unknown as AuxDepth;
        expect(resolveSceneDepthBindGroup(gpu.device, { depth: published })).toBe(published.bindGroup);
        expect(resolveSceneDepthBindGroup(gpu.device, {})).toBe(getSceneDepthFallback(gpu.device));
        expect(resolveSceneDepthBindGroup(gpu.device, undefined)).toBe(getSceneDepthFallback(gpu.device));
    });

    it('release destroys the fallback; the next request builds a fresh one', () => {
        const first = getSceneDepthFallback(gpu.device);
        releaseSceneDepthFallback(gpu.device);
        expect(gpu.textures.find((t) => t.descriptor.label === 'scene-depth-fallback')!.destroyed).toBe(true);
        expect(getSceneDepthFallback(gpu.device)).not.toBe(first);
        releaseSceneDepthFallback(undefined);
    });
});
