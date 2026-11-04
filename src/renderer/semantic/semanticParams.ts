/**
 * Per-frame `SceneSemanticParams` (#352) — pure, so the weight-0 contract is a
 * unit test: no map, semantic off or a zero preset weight pack all zeros, the
 * fallback's value, which every WGSL consumer turns into its pre-semantic
 * branch.
 */
import { wrapPanDelta, type DepthPov } from '../depth/depthScheduler';
import { LOOK_SCALE_H, LOOK_SCALE_V, type DepthMapPose } from '../depth/depthParams';
import { SCENE_SEMANTIC_PARAMS_FLOAT_COUNT, SceneSemanticParamIndex } from './sceneSemanticBinding';

/** Strength of each consumer, 0–1, before the preset weight × trust. */
export interface SemanticEffectWeights {
    rainSky: number;
    wetRoad: number;
    snowCover: number;
    fogSky: number;
    relight: number;
    skyReplace: number;
}

export const SEMANTIC_EFFECTS_DEFAULT: Readonly<SemanticEffectWeights> = {
    rainSky: 1,
    wetRoad: 1,
    snowCover: 1,
    fogSky: 1,
    relight: 1,
    skyReplace: 1,
};

export interface SemanticParamsInput {
    /** Preset `semanticBlend`; 0 when the layer is off. */
    blend: number;
    /** Trust in the map, 0–1 (the depth map's confidence rules). */
    confidence: number;
    view: DepthPov;
    map: DepthMapPose | null;
    effects: Readonly<SemanticEffectWeights>;
    /** `prefers-reduced-motion`: static clouds, no window flicker. */
    reducedMotion: boolean;
    /** The map's photo sky colour (`SemanticResult.skyColor`); zeros without sky. */
    skyColor: readonly [number, number, number];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function packSceneSemanticParams(
    input: SemanticParamsInput,
    out: Float32Array<ArrayBuffer> = new Float32Array(SCENE_SEMANTIC_PARAMS_FLOAT_COUNT),
): Float32Array<ArrayBuffer> {
    out.fill(0);
    const { map, view, effects } = input;
    const blend = clamp01(input.blend) * clamp01(input.confidence);
    if (!map || !(blend > 0)) return out;
    const I = SceneSemanticParamIndex;
    out[I.blend] = blend;
    out[I.shiftX] = wrapPanDelta(view.panX, map.panX) * LOOK_SCALE_H;
    out[I.shiftY] = (view.panY - map.panY) * LOOK_SCALE_V;
    out[I.rainSky] = clamp01(effects.rainSky);
    out[I.wetRoad] = clamp01(effects.wetRoad);
    out[I.snowCover] = clamp01(effects.snowCover);
    out[I.fogSky] = clamp01(effects.fogSky);
    out[I.relight] = clamp01(effects.relight);
    out[I.skyReplace] = clamp01(effects.skyReplace);
    out[I.zoom] = map.zoom;
    out[I.stillness] = input.reducedMotion ? 1 : 0;
    out[I.skyR] = clamp01(input.skyColor[0]);
    out[I.skyG] = clamp01(input.skyColor[1]);
    out[I.skyB] = clamp01(input.skyColor[2]);
    return out;
}
