import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    ACES_TONEMAP_SDR_BODY,
    APPLY_OPTIONAL_LUMA_REDUCE_SCALAR,
    assembleDualSourceWeatherShader,
    assembleExtendedToneMappingShader,
    deviceHasFeature,
    EXTENDED_TONEMAP_HEADROOM,
    HDR_INTERMEDIATE_FORMAT,
    HDR_INTERMEDIATE_FORMAT_PACKED,
    resolveHdrIntermediateFormat,
    resolveShaderFeatureUses,
    withSubgroupLumaReduce,
} from './shaderFeatureVariants';

const SHADER_ROOT = join(__dirname, '..', '..', 'public', 'shaders');

describe('resolveHdrIntermediateFormat', () => {
    it('keeps rgba16float when the packed feature is absent or alpha is required', () => {
        expect(resolveHdrIntermediateFormat([])).toBe(HDR_INTERMEDIATE_FORMAT);
        expect(resolveHdrIntermediateFormat(['rg11b10ufloat-renderable'], true))
            .toBe(HDR_INTERMEDIATE_FORMAT);
    });

    it('selects rg11b10ufloat when the feature is enabled and alpha is unused', () => {
        expect(resolveHdrIntermediateFormat(['rg11b10ufloat-renderable']))
            .toBe(HDR_INTERMEDIATE_FORMAT_PACKED);
    });
});

describe('shader feature gating', () => {
    it('deviceHasFeature is false without a features.has surface (jsdom / fakes)', () => {
        expect(deviceHasFeature(undefined, 'subgroups')).toBe(false);
        expect(deviceHasFeature({} as GPUDevice, 'subgroups')).toBe(false);
        const device = { features: { has: (n: GPUFeatureName) => n === 'subgroups' } } as unknown as GPUDevice;
        expect(deviceHasFeature(device, 'subgroups')).toBe(true);
        expect(deviceHasFeature(device, 'shader-f16')).toBe(false);
    });

    it('shader-f16 is never marked as used in a production shader', () => {
        const uses = resolveShaderFeatureUses(
            ['shader-f16', 'subgroups', 'rg11b10ufloat-renderable', 'dual-source-blending'],
            HDR_INTERMEDIATE_FORMAT_PACKED,
        );
        expect(uses.shaderF16).toBe(false);
        expect(uses.subgroups).toBe(true);
        expect(uses.rg11b10Intermediate).toBe(true);
        expect(uses.dualSourcePrecip).toBe(true);
    });
});

describe('withSubgroupLumaReduce', () => {
    it('leaves shaders without the helper unchanged (compat / fake fetch)', () => {
        expect(withSubgroupLumaReduce('// fake wgsl')).toBe('// fake wgsl');
    });

    it('prepends enable subgroups and replaces the scalar no-op', () => {
        const src = `// header\n${APPLY_OPTIONAL_LUMA_REDUCE_SCALAR}\n@compute fn main() {}\n`;
        const out = withSubgroupLumaReduce(src);
        expect(out.startsWith('enable subgroups;\n')).toBe(true);
        expect(out).toContain('subgroupAdd');
        expect(out).not.toContain('return col;\n}');
    });

    it('locks the scalar helper to weather-post-compute.wgsl', () => {
        const compute = readFileSync(join(SHADER_ROOT, 'weather-post-compute.wgsl'), 'utf8');
        expect(compute).toContain(APPLY_OPTIONAL_LUMA_REDUCE_SCALAR);
        expect(compute.startsWith('enable subgroups;')).toBe(false);
        expect(compute).not.toMatch(/^enable subgroups;/m);
    });
});

describe('assembleDualSourceWeatherShader', () => {
    const fragment = `@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = fragCoord.xy;
    if (p.shaderEffectsEnabled < 0.5) {
        return vec4<f32>(textureSample(sceneTex, linearSampler, uv).rgb, 1.0);
    }
    var col = vec3<f32>(0.0);
    var precipAdd = vec3<f32>(0.1);
    col = col + precipAdd;
    return vec4<f32>(col, 1.0);
}
`;

    it('leaves shaders without fs_main unchanged', () => {
        expect(assembleDualSourceWeatherShader('// fake')).toBe('// fake');
    });

    it('enables dual_source_blending and writes precip as src1', () => {
        const out = assembleDualSourceWeatherShader(fragment);
        expect(out.startsWith('enable dual_source_blending;\n')).toBe(true);
        expect(out).toContain('@second_blend_source precip');
        expect(out).toContain('DualFragOut(vec4<f32>(col, 1.0), vec4<f32>(precipAdd, 0.0))');
        expect(out).not.toContain('-> @location(0) vec4<f32>');
    });

    it('assembles dual-source from the generated fragment weather shader', () => {
        const fragment = readFileSync(join(SHADER_ROOT, 'weather-post.wgsl'), 'utf8');
        const out = assembleDualSourceWeatherShader(fragment);
        expect(out.startsWith('enable dual_source_blending;\n')).toBe(true);
        expect(out).toContain('@second_blend_source precip');
        expect(out).toContain('precipAdd');
    });
});

describe('gpu-chores hist variants', () => {
    it('keeps the scalar hist naga-clean and the subgroup file gated', () => {
        const scalar = readFileSync(join(SHADER_ROOT, 'gpu-chores-hist.wgsl'), 'utf8');
        const subgroups = readFileSync(join(SHADER_ROOT, 'gpu-chores-hist-subgroups.wgsl'), 'utf8');
        expect(scalar).not.toContain('enable subgroups;');
        expect(scalar).toContain('atomicAdd');
        expect(subgroups.startsWith('enable subgroups;')).toBe(true);
        expect(subgroups).toContain('subgroupShuffle');
        expect(subgroups).toContain('fn luma_histogram_bt709');
    });
});

describe('extended (output-referred) tone mapping', () => {
    const PRODUCTION_SHADERS = [
        'weather-post.wgsl',
        'weather-post-compute.wgsl',
    ] as const;

    it.each(PRODUCTION_SHADERS)('%s carries the exact SDR ACES body once', (name) => {
        const code = readFileSync(join(SHADER_ROOT, name), 'utf8');
        expect(code.split(ACES_TONEMAP_SDR_BODY)).toHaveLength(2);
    });

    it.each(PRODUCTION_SHADERS)('%s is byte-identical on the standard swap chain', (name) => {
        const code = readFileSync(join(SHADER_ROOT, name), 'utf8');
        expect(assembleExtendedToneMappingShader(code, 'standard')).toBe(code);
    });

    it.each(PRODUCTION_SHADERS)('%s drops the SDR crush when the canvas is extended', (name) => {
        const code = readFileSync(join(SHADER_ROOT, name), 'utf8');
        const out = assembleExtendedToneMappingShader(code, 'extended');
        expect(out).not.toBe(code);
        expect(out).not.toContain(ACES_TONEMAP_SDR_BODY);
        expect(out).toContain(`let headroom = ${EXTENDED_TONEMAP_HEADROOM.toFixed(1)};`);
        expect(out).toContain('let x = color / headroom;');
        // Still exactly one tonemap definition, still no `enable` directive.
        expect(out.split('fn aces_tonemap(')).toHaveLength(2);
        expect(out.startsWith('enable ')).toBe(false);
    });

    it('leaves a drifted / truncated shader on the historical curve', () => {
        const stub = 'fn aces_tonemap(color: vec3<f32>) -> vec3<f32> { return color; }';
        expect(assembleExtendedToneMappingShader(stub, 'extended')).toBe(stub);
    });

    it('composes with the dual-source assembler in either order', () => {
        const code = readFileSync(join(SHADER_ROOT, 'weather-post.wgsl'), 'utf8');
        const a = assembleDualSourceWeatherShader(assembleExtendedToneMappingShader(code, 'extended'));
        const b = assembleExtendedToneMappingShader(assembleDualSourceWeatherShader(code), 'extended');
        expect(a).toBe(b);
    });

    it('headroom stays at or above SDR white — below 1.0 would darken, not extend', () => {
        expect(EXTENDED_TONEMAP_HEADROOM).toBeGreaterThanOrEqual(1);
    });

    it('marks extendedToneMapping only for an applied extended canvas', () => {
        expect(resolveShaderFeatureUses([], 'rgba16float').extendedToneMapping).toBe(false);
        expect(resolveShaderFeatureUses([], 'rgba16float', 'standard').extendedToneMapping).toBe(false);
        expect(resolveShaderFeatureUses([], 'rgba16float', 'extended').extendedToneMapping).toBe(true);
    });
});

describe('validate:shaders variant lockstep', () => {
    it('the naga variant script substitutes exactly what the runtime assembles', async () => {
        const script = await import('../../scripts/validate-shaders.mjs');
        expect(script.SDR_ACES_TONEMAP_BODY).toBe(ACES_TONEMAP_SDR_BODY);
        expect(
            assembleExtendedToneMappingShader(ACES_TONEMAP_SDR_BODY, 'extended'),
        ).toBe(script.EXTENDED_ACES_TONEMAP_BODY);
    });
});
