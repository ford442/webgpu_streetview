/**
 * Optional WebGPU features already requested on the single `requestDevice`
 * callsite. Production shaders consume subgroups, packed HDR intermediates, and
 * dual-source precip when the adapter enabled them; scalar / rgba16float /
 * in-shader-composite fallbacks stay naga-clean.
 *
 * `shader-f16` stays requested-but-unused. A toy spike lives at
 * `scripts/f16-naga-spike.wgsl`; do not flip `shaderFeatureUses.shaderF16`
 * without a production shader (see docs/RENDERER_FALLBACK.md).
 */
import { OPTIONAL_DEVICE_FEATURES, type ShaderFeatureUses } from './deviceCapabilities';

export type { ShaderFeatureUses };

/** Default Pass-1 HDR intermediate (alpha kept). */
export const HDR_INTERMEDIATE_FORMAT: GPUTextureFormat = 'rgba16float';

/** Packed HDR intermediate when `rg11b10ufloat-renderable` is enabled and alpha is unused. */
export const HDR_INTERMEDIATE_FORMAT_PACKED: GPUTextureFormat = 'rg11b10ufloat';

export function deviceHasFeature(
    device: GPUDevice | null | undefined,
    name: GPUFeatureName,
): boolean {
    try {
        return device?.features?.has?.(name) === true;
    } catch {
        return false;
    }
}

/**
 * Choose the Pass-1 / hold-pause intermediate format. Alpha is unused on that
 * surface (weather samples `.rgb`; the swap-chain is opaque), so packed
 * 11-11-10 is a bandwidth win when the feature made the format renderable.
 */
export function resolveHdrIntermediateFormat(
    enabledFeatures: readonly GPUFeatureName[],
    needsAlpha = false,
): GPUTextureFormat {
    if (
        !needsAlpha
        && enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.rg11b10ufloatRenderable)
    ) {
        return HDR_INTERMEDIATE_FORMAT_PACKED;
    }
    return HDR_INTERMEDIATE_FORMAT;
}

/** Exact scalar body in `public/shaders/weather-post-compute.wgsl` — keep in lockstep. */
export const APPLY_OPTIONAL_LUMA_REDUCE_SCALAR =
    'fn applyOptionalLumaReduce(col: vec3<f32>) -> vec3<f32> {\n    return col;\n}';

const APPLY_OPTIONAL_LUMA_REDUCE_SUBGROUPS =
    'fn applyOptionalLumaReduce(col: vec3<f32>) -> vec3<f32> {\n'
    + '    let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));\n'
    + '    let sum = subgroupAdd(luma);\n'
    + '    let ballot = subgroupBallot(true);\n'
    + '    let n = countOneBits(ballot.x) + countOneBits(ballot.y) + countOneBits(ballot.z) + countOneBits(ballot.w);\n'
    + '    let mean = sum / f32(max(n, 1u));\n'
    + '    let hot = luma > mean * 32.0 && mean > 0.0;\n'
    + '    let scale = select(1.0, (mean * 32.0) / max(luma, 1e-6), hot);\n'
    + '    return col * scale;\n'
    + '}';

/**
 * Prepend `enable subgroups;` and replace the scalar luma-reduce no-op.
 * Missing helper (test fakes, truncated fetches) stays scalar so `?gpu=compat`
 * and jsdom characterization tests still boot.
 */
export function withSubgroupLumaReduce(shaderCode: string): string {
    if (!shaderCode.includes('fn applyOptionalLumaReduce(')) {
        return shaderCode;
    }
    if (shaderCode.includes('enable subgroups;')) {
        return shaderCode;
    }
    const replaced = shaderCode.replace(
        APPLY_OPTIONAL_LUMA_REDUCE_SCALAR,
        APPLY_OPTIONAL_LUMA_REDUCE_SUBGROUPS,
    );
    if (replaced === shaderCode) {
        return shaderCode;
    }
    return `enable subgroups;\n${replaced}`;
}

const FS_MAIN_SCALAR_SIG =
    'fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {';

const FS_MAIN_DUAL_SIG = `struct DualFragOut {
    @location(0) color: vec4<f32>,
    @location(0) @second_blend_source precip: vec4<f32>,
}

fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> DualFragOut {`;

const BYPASS_SCALAR =
    '        return vec4<f32>(textureSample(sceneTex, linearSampler, uv).rgb, 1.0);';
const BYPASS_DUAL =
    '        return DualFragOut(vec4<f32>(textureSample(sceneTex, linearSampler, uv).rgb, 1.0), vec4<f32>(0.0));';

const FINAL_SCALAR = '    return vec4<f32>(col, 1.0);\n}';
const FINAL_DUAL = '    return DualFragOut(vec4<f32>(col, 1.0), vec4<f32>(precipAdd, 0.0));\n}';

/**
 * Dual-source fragment weather: same `fs_main` math, precip in `@second_blend_source`.
 * The production `weather-post.wgsl` stays naga-clean (no `enable`); this wrapper
 * is assembled at pipeline-create time when the device enabled the feature.
 */
export function assembleDualSourceWeatherShader(shaderCode: string): string {
    if (!shaderCode.includes(FS_MAIN_SCALAR_SIG) || shaderCode.includes('enable dual_source_blending;')) {
        return shaderCode;
    }
    const withSig = shaderCode.replace(FS_MAIN_SCALAR_SIG, FS_MAIN_DUAL_SIG);
    const withBypass = withSig.replace(BYPASS_SCALAR, BYPASS_DUAL);
    const withReturn = withBypass.replace(FINAL_SCALAR, FINAL_DUAL);
    if (withReturn === shaderCode) {
        return shaderCode;
    }
    return `enable dual_source_blending;\n${withReturn}`;
}

/** Blend state that references src1. Cleared dest → `color + 0 * precip` = in-shader composite. */
export const DUAL_SOURCE_PRECIP_BLEND: GPUBlendState = {
    color: { operation: 'add', srcFactor: 'one', dstFactor: 'src1' },
    alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'zero' },
};

export function resolveShaderFeatureUses(
    enabledFeatures: readonly GPUFeatureName[],
    intermediateFormat: GPUTextureFormat,
): ShaderFeatureUses {
    return {
        subgroups: enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.subgroups),
        rg11b10Intermediate: intermediateFormat === HDR_INTERMEDIATE_FORMAT_PACKED,
        dualSourcePrecip: enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.dualSourceBlending),
        shaderF16: false,
    };
}
