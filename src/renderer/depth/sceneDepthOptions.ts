/**
 * What `WebGPUCanvas` asks the renderer for each frame — resolved here so the
 * policy (opt-in × quality preset × reduced motion) is one tested function.
 */
import { PRESETS, type QualityLevel } from '../../config/visualPresets';

export interface SceneDepthOptions {
    /** Opted in (panel toggle / `?depth`) and the preset's weight is above 0. */
    enabled: boolean;
    /** Preset `depthBlend`. */
    blend: number;
    /** `prefers-reduced-motion` / the a11y toggle: no release dolly. */
    reducedMotion: boolean;
}

export function resolveSceneDepthOptions(
    input: { quality: QualityLevel; optedIn: boolean; reducedMotion: boolean },
    out: SceneDepthOptions = { enabled: false, blend: 0, reducedMotion: false },
): SceneDepthOptions {
    const blend = PRESETS[input.quality].depthBlend;
    out.enabled = input.optedIn && blend > 0;
    out.blend = out.enabled ? blend : 0;
    out.reducedMotion = input.reducedMotion;
    return out;
}
