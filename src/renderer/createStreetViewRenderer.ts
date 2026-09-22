import { Renderer } from './Renderer';
import {
    exposeRendererDebugGlobals,
    exposeRendererHardFailGlobals,
    getLegacyTransitionsEnabled,
    getRendererDebugOptions,
    getRendererPreference,
    getWeatherPostProcessModePolicy,
    RendererBackendType,
    RendererDebugOptions,
    RendererInitOptions,
    StreetViewRenderer,
    WeatherPostProcessMode,
} from './RendererBackend';
import { getPreset, detectRecommendedQuality } from '../config/visualPresets';
import { publishWebGpuProbe, type WebGpuProbeStage } from './webgpuBootProbe';

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
    const quality = detectRecommendedQuality();
    const presetDefaultWeatherMode = getPreset(quality).weatherPostProcessMode;
    const weatherPolicy = getWeatherPostProcessModePolicy(presetDefaultWeatherMode);
    const weatherPostProcessMode = weatherPolicy.mode;
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

    const attempt = await attemptRendererBoot(canvas, {
        ...options,
        weatherPostProcessMode,
        legacyTransitions,
    });
    let renderer = attempt.renderer;
    let success = attempt.success;

    // One-step degrade, and one only: an adapter that cannot meet the compute
    // weather limits re-boots on fragment weather, but only when compute came
    // from the quality preset rather than `?weather=compute` / the stored
    // preference. The degrade is published on `webgpuProbe.weatherDegrade` —
    // it is never silent, because the preset would otherwise claim a pipeline
    // it is not running. An explicit compute request still hard-fails.
    if (!success
        && weatherPostProcessMode === 'compute'
        && weatherPolicy.source === 'preset'
        && failedOnAdapterLimits()) {
        const reason = renderer.fallbackReason || 'Adapter limits below compute weather minimums';
        console.warn(
            `[Renderer] ${quality} preset compute weather exceeds this adapter's limits `
            + `(${reason}); degrading once to fragment weather.`,
        );
        renderer.destroy();

        const degraded: DegradeRecord = { from: 'compute', to: 'fragment', reason };
        const retry = await attemptRendererBoot(canvas, {
            ...options,
            weatherPostProcessMode: 'fragment',
            legacyTransitions,
        });
        renderer = retry.renderer;
        success = retry.success;
        publishWebGpuProbe({
            ok: success,
            stage: success ? 'ok' : (readProbeStage() ?? 'limits'),
            reason: success ? '' : (renderer.fallbackReason || reason),
            preference,
            webglPreferenceDeferred,
            weatherDegrade: degraded,
        });
    }

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

interface DegradeRecord {
    from: WeatherPostProcessMode;
    to: WeatherPostProcessMode;
    reason: string;
}

/** Construct a Renderer and run its init, so the degrade path can do it twice. */
async function attemptRendererBoot(
    canvas: HTMLCanvasElement,
    initOptions: RendererInitOptions,
): Promise<{ renderer: Renderer; success: boolean }> {
    const renderer = new Renderer(canvas);
    const success = await renderer.init(initOptions);
    return { renderer, success };
}

/** The stage `bootDevice` last published, or undefined outside a browser. */
function readProbeStage(): WebGpuProbeStage | undefined {
    if (typeof window === 'undefined') return undefined;
    return window.webgpuProbe?.stage;
}

/** True when `bootDevice` rejected the adapter at the required-limits gate. */
function failedOnAdapterLimits(): boolean {
    return readProbeStage() === 'limits';
}
