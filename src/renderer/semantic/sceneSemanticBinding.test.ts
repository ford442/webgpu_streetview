import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeGpu, installGpuGlobals, type FakeGpu } from '../computeWeather/__tests__/fakeGpu';
import {
    getSceneSemanticBindGroupLayout,
    getSceneSemanticFallback,
    releaseSceneSemanticFallback,
    resolveSceneSemanticBindGroup,
    SCENE_SEMANTIC_PARAMS_BYTE_SIZE,
    SCENE_SEMANTIC_PARAMS_FLOAT_COUNT,
    SceneSemanticParamIndex,
    WEATHER_SCENE_SEMANTIC_GROUP,
    type AuxSemantic,
} from './sceneSemanticBinding';
import { SEMANTIC_CLASS_COUNT, SEMANTIC_CLASS_NAMES, SemanticClass } from './semanticClasses';
import { WEATHER_SCENE_DEPTH_GROUP } from '../depth/sceneDepthBinding';

const shaderDir = join(__dirname, '..', '..', '..', 'public', 'shaders');
const read = (name: string) => readFileSync(join(shaderDir, name), 'utf8');
const WEATHER_SHADERS = ['weather-post.wgsl', 'weather-post-compute.wgsl'] as const;

function structFields(source: string): string[] {
    const start = source.indexOf('struct SceneSemanticParams');
    const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start));
    return body
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').trim())
        .filter(Boolean)
        .map((line) => {
            const m = /^(\w+)\s*:\s*f32,?$/.exec(line);
            if (!m) throw new Error(`unexpected SceneSemanticParams member: ${line}`);
            return m[1]!;
        });
}

/** Body of `fn name(...) { ... }`, brace-matched. */
function fnBody(source: string, name: string): string {
    const start = source.indexOf(`fn ${name}(`);
    if (start < 0) throw new Error(`fn ${name} not found`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`fn ${name} unterminated`);
}

/** The compute shader names the frame texture/sampler differently; nothing else may differ. */
const normalize = (body: string) => body.replace(/readTexture/g, 'sceneTex').replace(/u_sampler/g, 'linearSampler');

const HELPERS = [
    'semanticMapUv',
    'semanticTexel',
    'sceneClass',
    'classWeight',
    'semanticSkyKey',
    'semanticRain',
    'semanticFog',
    'semanticWetRoad',
    'semanticSnowCover',
    'semanticRelight',
    'semanticSkyMatte',
    'perezTerm',
    'preethamSky',
    'bearingDir',
    'semanticSky',
] as const;

/** Helpers that change a colour / amount: each must open with its weight-0 return. */
const EFFECTS = [
    ['semanticRain', 'return streaks;'],
    ['semanticFog', 'return fogAmount;'],
    ['semanticWetRoad', 'return col;'],
    ['semanticSnowCover', 'return col;'],
    ['semanticRelight', 'return col;'],
    ['semanticSky', 'return col;'],
    ['classWeight', 'return 0.0;'],
    ['semanticSkyKey', 'return 0.0;'],
    ['semanticSkyMatte', 'return 0.0;'],
] as const;

describe('SceneSemanticParams — one layout in TS and both weather shaders', () => {
    it.each(WEATHER_SHADERS)('%s declares the fields at the indices SceneSemanticParamIndex names', (name) => {
        const fields = structFields(read(name));
        expect(fields).toHaveLength(SCENE_SEMANTIC_PARAMS_FLOAT_COUNT);
        for (const [field, index] of Object.entries(SceneSemanticParamIndex)) {
            expect(fields[index], field).toBe(field);
        }
        expect(SCENE_SEMANTIC_PARAMS_BYTE_SIZE % 16).toBe(0);
    });

    it.each(WEATHER_SHADERS)('%s binds map, sampler, params at group 3', (name) => {
        const source = read(name);
        expect(WEATHER_SCENE_SEMANTIC_GROUP).toBe(3);
        expect(WEATHER_SCENE_SEMANTIC_GROUP).not.toBe(WEATHER_SCENE_DEPTH_GROUP);
        expect(source).toContain('@group(3) @binding(0) var semanticTex: texture_2d<f32>;');
        expect(source).toContain('@group(3) @binding(1) var semanticSampler: sampler;');
        expect(source).toContain('@group(3) @binding(2) var<uniform> semParams: SceneSemanticParams;');
    });

    it.each(WEATHER_SHADERS)('%s numbers the classes as semanticClasses.ts does', (name) => {
        const source = read(name);
        expect(SEMANTIC_CLASS_NAMES).toHaveLength(SEMANTIC_CLASS_COUNT);
        for (const [cls, id] of Object.entries(SemanticClass)) {
            expect(source).toContain(`const CLASS_${cls.toUpperCase()}: i32 = ${id};`);
        }
    });
});

describe('semantic WGSL helpers', () => {
    it.each(HELPERS)('%s is byte-identical in the fragment and compute shaders', (name) => {
        expect(normalize(fnBody(read('weather-post-compute.wgsl'), name)))
            .toBe(fnBody(read('weather-post.wgsl'), name));
    });

    it.each(EFFECTS)('%s returns its input first when semParams.blend is 0 (bit-exact)', (name, ret) => {
        const body = fnBody(read('weather-post.wgsl'), name);
        const firstStatement = body.slice(body.indexOf('{') + 1).trim().split('\n')[0]!;
        expect(firstStatement).toMatch(/^if \(semParams\.blend <= 0\.0[ |)]/);
        expect(firstStatement).toContain(ret);
    });

    it('the compute-only particle layer thins its rain over the sky, bit-exact at weight 0', () => {
        const source = read('weather-post-compute.wgsl');
        const body = fnBody(source, 'semanticRainParticles');
        expect(body.slice(body.indexOf('{') + 1).trim().split('\n')[0]).toBe('if (semParams.blend <= 0.0) { return layer; }');
        expect(source).toContain('let particleLayer = semanticRainParticles(applyParticlePrecipitation(');
        // The fragment path has no particle layer.
        expect(read('weather-post.wgsl')).not.toContain('semanticRainParticles');
    });

    it('class ids are only ever compared after loading, never filtered', () => {
        for (const name of WEATHER_SHADERS) {
            const source = read(name);
            expect(source).not.toMatch(/textureSample\w*\(semanticTex/);
        }
    });

    it.each(WEATHER_SHADERS)('%s routes every effect through its helper in the entry point', (name) => {
        const source = read(name);
        for (const call of [
            'semanticRelight(col, graded, uv,',
            'col = semanticSky(col, uv,',
            'let fogMask = semanticFog(fogAmountAt(',
            'semanticRain(rain(uv, t, panX, panY), uv)',
            'col = semanticWetRoad(col, uv,',
            'col = semanticSnowCover(col, uv,',
        ]) {
            expect(source, call).toContain(call);
        }
    });
});

describe('the scene-semantic layout and fallback', () => {
    let gpu: FakeGpu;
    beforeEach(() => {
        installGpuGlobals();
        gpu = createFakeGpu();
    });

    it('builds one layout per device: texture, filtering sampler, uniform', () => {
        const a = getSceneSemanticBindGroupLayout(gpu.device);
        expect(getSceneSemanticBindGroupLayout(gpu.device)).toBe(a);
        const entries = gpu.bindGroupLayouts.find((l) => l === (a as unknown))!.entries;
        expect(entries.map((e) => e.binding)).toEqual([0, 1, 2]);
        expect(entries[0]!.texture?.sampleType).toBe('float');
        expect(entries[1]!.sampler?.type).toBe('filtering');
        expect(entries[2]!.buffer?.type).toBe('uniform');
    });

    it('the fallback is a 1×1 unlabelled rg8unorm map and a never-written (blend 0) params block', () => {
        const group = getSceneSemanticFallback(gpu.device);
        expect(getSceneSemanticFallback(gpu.device)).toBe(group);
        const texture = gpu.textures.find((t) => t.descriptor.label === 'scene-semantic-fallback')!;
        expect(texture.descriptor.size).toEqual([1, 1]);
        expect(texture.descriptor.format).toBe('rg8unorm');
        const params = gpu.buffers.find((b) => b.descriptor.label === 'scene-semantic-fallback-params')!;
        expect(params.descriptor.size).toBe(SCENE_SEMANTIC_PARAMS_BYTE_SIZE);
        expect(gpu.writeBufferCalls.filter((c) => c.buffer === params)).toHaveLength(0);
    });

    it('resolves the published map when there is one, else the fallback', () => {
        const published = { bindGroup: { kind: 'published' } } as unknown as AuxSemantic;
        expect(resolveSceneSemanticBindGroup(gpu.device, { semantic: published })).toBe(published.bindGroup);
        expect(resolveSceneSemanticBindGroup(gpu.device, {})).toBe(getSceneSemanticFallback(gpu.device));
        expect(resolveSceneSemanticBindGroup(gpu.device, undefined)).toBe(getSceneSemanticFallback(gpu.device));
    });

    it('release destroys the fallback; the next request builds a fresh one', () => {
        const first = getSceneSemanticFallback(gpu.device);
        releaseSceneSemanticFallback(gpu.device);
        expect(gpu.textures.find((t) => t.descriptor.label === 'scene-semantic-fallback')!.destroyed).toBe(true);
        expect(getSceneSemanticFallback(gpu.device)).not.toBe(first);
        releaseSceneSemanticFallback(undefined);
    });
});
