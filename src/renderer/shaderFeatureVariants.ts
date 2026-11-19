/**
 * Optional WebGPU features already requested on the single `requestDevice`
 * callsite, and the linked shader variant each selects. Production shaders
 * consume subgroups (the gpu-chores histogram), packed HDR intermediates, and
 * dual-source precip when the adapter enabled them; every variant is a file
 * `scripts/gen-shaders.mjs` linked from the WESL sources and naga validated.
 *
 * `shader-f16` stays requested-but-unused until a production pass uses `f16`
 * (see scripts/f16-naga-spike.wgsl and docs/RENDERER_FALLBACK.md).
 */
import shaderManifest from '../shaders/shaders.manifest.json';
import { OPTIONAL_DEVICE_FEATURES, type ShaderFeatureUses } from './deviceCapabilities';

/** Tone mapping mode `configureCanvasContext` applied to the swap chain. */
export type CanvasToneMapping = 'standard' | 'extended';

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

/**
 * SDR-relative peak the extended-range grade rolls highlights into.
 *
 * `toneMapping: { mode: 'extended' }` (see `deviceInit.ts`) tells the browser the
 * swap chain carries values above SDR white; 4.0 is a conservative headroom that
 * every HDR display Chrome reports today can show, and the browser clamps what it
 * cannot. Keep it ≥ 1.0 — at exactly 1.0 the extended body is algebraically the
 * SDR body. The WGSL literal is `aces_tonemap`'s `hdr_grade` body in
 * `src/shaders/weather/grade.wesl` (`linkedShaders.test.ts` holds them equal).
 */
export const EXTENDED_TONEMAP_HEADROOM = 4.0;

/** A `@if` condition of `src/shaders/**\/*.wesl` that selects a linked variant. */
export type ShaderCondition = 'dual_source' | 'hdr_grade' | 'subgroups';

/** An entry of `src/shaders/shaders.manifest.json`: one `.wesl` root, linked once per condition subset. */
export type LinkedShaderEntry = keyof typeof shaderManifest.entries;

/**
 * The `public/shaders` file `scripts/gen-shaders.mjs` linked for `entry` with
 * the `enabled` conditions: `<entry>[.<condition>...].wgsl`, conditions in
 * manifest order. Variants are chosen by name — nothing is assembled or linked
 * at runtime. Throws for a condition the entry does not have, so a typo cannot
 * quietly fetch the default.
 */
export function linkedShaderFile(
    entry: LinkedShaderEntry,
    enabled: Partial<Record<ShaderCondition, boolean>> = {},
): string {
    const spec = shaderManifest.entries[entry];
    const conditions: readonly string[] = 'conditions' in spec ? spec.conditions : [];
    for (const [name, on] of Object.entries(enabled)) {
        if (on && !conditions.includes(name)) {
            throw new Error(`linkedShaderFile: ${entry} has no "${name}" variant`);
        }
    }
    return [entry, ...conditions.filter((c) => enabled[c as ShaderCondition] === true)].join('.') + '.wgsl';
}

/**
 * The fragment weather pass's linked variant. Callers pass the tone mapping
 * `configureCanvasContext` actually applied, never the requested flag — a
 * rejected `?hdr=1` configure falls back to SDR sRGB and keeps the SDR grade.
 * `dualSource`: the device enabled `dual-source-blending`, so precipitation also
 * leaves through `@blend_src(1)` (`DUAL_SOURCE_PRECIP_BLEND`).
 */
export function weatherPostShaderFile(canvasToneMapping: CanvasToneMapping, dualSource: boolean): string {
    return linkedShaderFile('weather-post', {
        dual_source: dualSource,
        hdr_grade: canvasToneMapping === 'extended',
    });
}

/** The compute weather pass's linked variant (see `weatherPostShaderFile`). */
export function computeWeatherShaderFile(canvasToneMapping: CanvasToneMapping): string {
    return linkedShaderFile('weather-post-compute', { hdr_grade: canvasToneMapping === 'extended' });
}

/** Blend state that references src1. Cleared dest → `color + 0 * precip` = in-shader composite. */
export const DUAL_SOURCE_PRECIP_BLEND: GPUBlendState = {
    color: { operation: 'add', srcFactor: 'one', dstFactor: 'src1' },
    alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'zero' },
};

export function resolveShaderFeatureUses(
    enabledFeatures: readonly GPUFeatureName[],
    intermediateFormat: GPUTextureFormat,
    canvasToneMapping: CanvasToneMapping = 'standard',
): ShaderFeatureUses {
    return {
        subgroups: enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.subgroups),
        rg11b10Intermediate: intermediateFormat === HDR_INTERMEDIATE_FORMAT_PACKED,
        dualSourcePrecip: enabledFeatures.includes(OPTIONAL_DEVICE_FEATURES.dualSourceBlending),
        shaderF16: false,
        extendedToneMapping: canvasToneMapping === 'extended',
    };
}
