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
import { fnSource, readLinked, readWesl, squash } from '../../shaders/__tests__/shaderSources';

/** The linked weather shaders, as the device receives them (default variants). */
const read = readLinked;
const WEATHER_SHADERS = ['weather-post.wgsl', 'weather-post-compute.wgsl'] as const;
/** Where the semantic helpers are written, once, for both weather paths. */
const SEMANTIC_SOURCES = () => readWesl('weather/semantic.wesl') + readWesl('weather/sky.wesl');

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

const fnBody = fnSource;

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

    it('weather/semantic.wesl binds map, sampler, params at group 3 for both paths', () => {
        const source = readWesl('weather/semantic.wesl');
        expect(WEATHER_SCENE_SEMANTIC_GROUP).toBe(3);
        expect(WEATHER_SCENE_SEMANTIC_GROUP).not.toBe(WEATHER_SCENE_DEPTH_GROUP);
        expect(source).toContain('@group(3) @binding(0) var semanticTex: texture_2d<f32>;');
        expect(source).toContain('@group(3) @binding(1) var semanticSampler: sampler;');
        expect(source).toContain('@group(3) @binding(2) var<uniform> semParams: SceneSemanticParams;');
    });

    it('weather/semantic.wesl numbers the classes as semanticClasses.ts does', () => {
        const source = readWesl('weather/semantic.wesl');
        expect(SEMANTIC_CLASS_NAMES).toHaveLength(SEMANTIC_CLASS_COUNT);
        for (const [cls, id] of Object.entries(SemanticClass)) {
            expect(source).toContain(`const CLASS_${cls.toUpperCase()}: i32 = ${id};`);
        }
    });
});

describe('semantic WGSL helpers', () => {
    it.each(HELPERS)('%s is written once, in weather/semantic|sky.wesl, and linked into both paths', (name) => {
        expect(SEMANTIC_SOURCES().match(new RegExp(`\\bfn ${name}\\(`, 'g'))).toHaveLength(1);
        // Linked wherever an entry calls it (the linker drops what nothing calls),
        // and then from that one source, so the bodies agree path for path.
        const linked = WEATHER_SHADERS.map(read).filter((code) => new RegExp(`\\bfn ${name}\\(`).test(code));
        for (const code of linked) expect(squash(fnBody(code, name))).toBe(squash(fnBody(linked[0]!, name)));
    });

    it.each(EFFECTS)('%s returns its input first when semParams.blend is 0 (bit-exact)', (name, ret) => {
        const body = fnBody(SEMANTIC_SOURCES(), name);
        const firstStatement = body.slice(body.indexOf('{') + 1).trim().split('\n')[0]!;
        expect(firstStatement).toMatch(/^if \(semParams\.blend <= 0\.0[ |)]/);
        expect(firstStatement).toContain(ret);
    });

    it('the compute-only particle layer thins its rain over the sky, bit-exact at weight 0', () => {
        const body = fnBody(SEMANTIC_SOURCES(), 'semanticRainParticles');
        expect(body.slice(body.indexOf('{') + 1).trim().split('\n')[0]).toBe('if (semParams.blend <= 0.0) { return layer; }');
        expect(readWesl('weather-post-compute.wesl')).toContain('let particleLayer = semanticRainParticles(applyParticlePrecipitation(');
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
