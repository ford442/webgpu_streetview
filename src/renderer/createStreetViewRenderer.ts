import { Renderer } from './Renderer';
import {
    exposeRendererDebugGlobals,
    exposeRendererHardFailGlobals,
    getLegacyTransitionsEnabled,
    getRendererDebugOptions,
    getRendererPreference,
    getWeatherPostProcessMode,
    RendererBackendType,
    RendererDebugOptions,
    RendererInitOptions,
    StreetViewRenderer,
} from './RendererBackend';
import { getPreset, detectRecommendedQuality } from '../config/visualPresets';
import { publishWebGpuProbe } from './webgpuBootProbe';

export interface RendererCreateResult {
    renderer: StreetViewRenderer | null;
    backendType: RendererBackendType | null;
    fallbackReason?: string;
    debugOptions: RendererDebugOptions;
}

/**
 * Create the Street View post-process renderer.
 *
 * WebGPU is required. The WebGL2 weather class was removed from the runtime
 * module graph; GLSL lives in `src/renderer/webgl/weatherReference.glsl.ts`
 * for tests/docs only. `?renderer=webgl` still probes WebGPU only.
 */
export async function createStreetViewRenderer(
    canvas: HTMLCanvasElement,
    options?: RendererInitOptions
): Promise<RendererCreateResult> {
    const preference = getRendererPreference();
    const debugOptions = getRendererDebugOptions();
    const webglPreferenceDeferred = preference === 'webgl';
    const presetDefaultWeatherMode = getPreset(detectRecommendedQuality()).weatherPostProcessMode;
    const weatherPostProcessMode = getWeatherPostProcessMode(presetDefaultWeatherMode);
    const legacyTransitions = getLegacyTransitionsEnabled(false);

    publishWebGpuProbe({
        ok: false,
        stage: 'navigator',
        reason: '',
        preference,
        webglPreferenceDeferred,
    });

    if (webglPreferenceDeferred) {
        console.warn(
            '[Renderer] WebGL weather is a GLSL reference only; probing WebGPU. ' +
            'There is no live GL weather backend.',
        );
    }

    const renderer = new Renderer(canvas);
    const initOptions: RendererInitOptions = {
        ...options,
        weatherPostProcessMode,
        legacyTransitions,
    };

    const success = await renderer.init(initOptions);
    if (success) {
        exposeRendererDebugGlobals(
            'webgpu',
            undefined,
            debugOptions,
            (nextDebugOptions) => {
                Object.assign(debugOptions, nextDebugOptions);
                renderer.setDebugOptions?.(debugOptions);
            },
            renderer.getWeatherPostProcessMode?.()
        );
        renderer.setDebugOptions?.(debugOptions);
        return {
            renderer,
            backendType: 'webgpu',
            debugOptions,
        };
    }

    const fallbackReason =
        renderer.fallbackReason ||
        (preference === 'webgpu'
            ? 'Requested WebGPU renderer failed to initialize'
            : 'WebGPU renderer failed to initialize');

    // Ensure hard-fail breadcrumbs even if Renderer.init returned before publishing.
    publishWebGpuProbe({
        ok: false,
        stage: (typeof window !== 'undefined' && window.webgpuProbe?.stage) || 'device',
        reason: fallbackReason,
        preference,
        webglPreferenceDeferred,
    });

    exposeRendererHardFailGlobals(fallbackReason, debugOptions);
    renderer.destroy();

    return {
        renderer: null,
        backendType: null,
        fallbackReason,
        debugOptions,
    };
}
