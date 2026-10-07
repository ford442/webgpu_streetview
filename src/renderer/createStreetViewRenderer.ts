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
import { readFlag } from '../config/flags';
import { WEBGL2_FALLBACK_ACTIVE_MESSAGE } from './webgl2FallbackMessages';

export interface RendererCreateResult {
    renderer: StreetViewRenderer | null;
    backendType: RendererBackendType | null;
    fallbackReason?: string;
    debugOptions: RendererDebugOptions;
}

/**
 * Create the Street View post-process renderer.
 *
 * WebGPU is required by default — a WebGPU failure hard-fails visibly. Only
 * `?webgl2=1` opts into `WebGL2FallbackRenderer`, and only after WebGPU fails;
 * there is never an automatic fallback. `?renderer=webgl` still probes WebGPU.
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

    renderer.destroy();

    if (readFlag('webgl2')) {
        const gl = await attemptWebGL2Boot(canvas, debugOptions, fallbackReason);
        if (gl) return gl;
    }

    exposeRendererHardFailGlobals(fallbackReason, debugOptions);

    return {
        renderer: null,
        backendType: null,
        fallbackReason,
        debugOptions,
    };
}

/**
 * `?webgl2=1` only. Loaded lazily so the default WebGPU bundle never carries it.
 * Null when WebGL2 is unavailable too (e.g. the canvas already holds a
 * `webgpu` context), and the caller hard-fails as usual.
 */
async function attemptWebGL2Boot(
    canvas: HTMLCanvasElement,
    debugOptions: RendererDebugOptions,
    webgpuFailure: string,
): Promise<RendererCreateResult | null> {
    const { WebGL2FallbackRenderer } = await import('./webgl/WebGL2FallbackRenderer');
    const reason = `WebGPU failed: ${webgpuFailure}`;
    const renderer = new WebGL2FallbackRenderer(canvas, debugOptions, reason);
    if (!(await renderer.init())) {
        console.error(`[Renderer] ?webgl2=1 set but WebGL2 also failed to initialize (${reason}).`);
        renderer.destroy();
        return null;
    }
    console.warn(`[Renderer] ${WEBGL2_FALLBACK_ACTIVE_MESSAGE} (${reason})`);
    exposeRendererDebugGlobals(
        'webgl',
        reason,
        debugOptions,
        (nextDebugOptions) => {
            Object.assign(debugOptions, nextDebugOptions);
            renderer.setDebugOptions(debugOptions);
        },
    );
    return { renderer, backendType: 'webgl', fallbackReason: reason, debugOptions };
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
