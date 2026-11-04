/**
 * What the frame driver asks the renderer for each frame (#352): opt-in ×
 * scene depth on × the quality preset's weight, as one tested function.
 */
import { PRESETS, type QualityLevel } from '../../config/visualPresets';

export interface SceneSemanticOptions {
    /** Opted in, scene depth enabled, and the preset's weight is above 0. */
    enabled: boolean;
    /** Preset `semanticBlend`. */
    blend: number;
    /** `prefers-reduced-motion`: the sky's clouds hold still, windows do not flicker. */
    reducedMotion: boolean;
}

export function resolveSceneSemanticOptions(
    input: { quality: QualityLevel; optedIn: boolean; depthEnabled: boolean; reducedMotion: boolean },
    out: SceneSemanticOptions = { enabled: false, blend: 0, reducedMotion: false },
): SceneSemanticOptions {
    const blend = PRESETS[input.quality].semanticBlend;
    out.enabled = input.optedIn && input.depthEnabled && blend > 0;
    out.blend = out.enabled ? blend : 0;
    out.reducedMotion = input.reducedMotion;
    return out;
}
