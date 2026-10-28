import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createStreetViewRenderer } from '../renderer/createStreetViewRenderer';
import { type RendererBackendType, type StreetViewRenderer } from '../renderer/RendererBackend';
import {
    useWeatherSettings,
    useLightingSettings,
    useGradeSettings,
    useStreetView,
} from '../hooks';
import { WasmNoiseFeeder, getWasmNoisePreference } from '../wasm/wasmNoiseFeeder';
import { WasmParticleFeeder, getWasmParticlePreference } from '../wasm/wasmParticleFeeder';
import { getActiveQualityLevel, PRESETS } from '../config/visualPresets';
import { prefersReducedMotion, isCinematicQuality } from '../renderer/cinematicCameraFx';
import { fetchLookLutVolume } from '../renderer/lut';
import { FrameDriver } from '../renderer/frameDriver';
import { DeviceLossRecovery } from '../renderer/deviceLossRecovery';
import {
    DEFAULT_MAX_TEXTURE_DIMENSION,
    dprCapForPixelRatio,
    observeCanvasBox,
    resolveBackingStoreSize,
    type CanvasBoxSize,
} from './canvasBackingStore';

/**
 * ⚠️ CRITICAL INTEGRATION NOTES - DO NOT REMOVE ⚠️
 * The road's frame loop is `renderer/frameDriver.ts`; this component mounts
 * the canvas, boots (and re-boots) the renderer, and keeps the driver's inputs
 * current. It has no rAF of its own and does not re-render per frame.
 * 1. WEATHER SYNC: This canvas MUST read the environment slices (`useWeatherSettings()` etc.)
 *    and hand them to the driver (`driver.env`), which packs them into
 *    `renderer.updateWeatherParams()` every frame. If disconnected, the UI
 *    sliders will move but shaders will not react.
 * 2. CRUISE PAUSE: While `isPanoramaUpdatePaused`, the driver calls
 *    `renderHeldFrame()` so the GPU snapshot is drawn without uploading the
 *    loading Google Maps canvas. The flag is written to the driver during
 *    render, so the frame after the hold arms already sees it.
 * 3. EVERY FRAME RENDERS: there is no frame skipping — see `frameDriver.ts`.
 */

interface WebGPUCanvasProps {
    onWebGPUStatus?: (available: boolean) => void;
    onBackendInfo?: (info: { backendType: RendererBackendType | null; fallbackReason?: string }) => void;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ onWebGPUStatus, onBackendInfo }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const internalRendererRef = useRef<StreetViewRenderer | null>(null);
    
    // Environment slices (weather / lighting / grade) — the canvas has no use for
    // the car-only slice (wipers, roof), so toggling those does not re-render it.
    const { rainIntensity, snowIntensity, wind, fogDensity } = useWeatherSettings();
    const {
        nightIntensity, headlightsOn, highBeam, domeLightOn,
        sunAzimuth, sunAltitude, moonAzimuth, moonAltitude,
        timeOfDay,
    } = useLightingSettings();
    const {
        vibrance, saturation, contrast, exposure, temperature, tint,
        shaderEffectsEnabled, activeLookId, autoExposureEnabled,
    } = useGradeSettings();

    // Get street view state
    const {
        canvas: source,
        isPanoramaUpdatePaused,
        setRenderer,
    } = useStreetView();

    // Backing-store size in device pixels (CSS size stays 100%) — see
    // canvasBackingStore.ts. Seeded from the window until the observer reports.
    const [size, setSize] = useState(() => resolveBackingStoreSize({
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        dprCap: dprCapForPixelRatio(PRESETS[getActiveQualityLevel()].pixelRatio),
        maxTextureDimension: DEFAULT_MAX_TEXTURE_DIMENSION,
    }));
    const canvasBoxRef = useRef<CanvasBoxSize | null>(null);

    // Performance: debounced resize — every backing-store change reallocates
    // the intermediate (and the compute weather targets), so a drag-resize
    // settles before it is applied. The first observation applies at once.
    const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // WASM-driven ambient dust turbulence (see src/wasm/wasmNoiseFeeder.ts).
    // ?wasmNoise=off (or a stored streetview.wasmNoise=off preference) disables it.
    const noiseFeederRef = useRef<WasmNoiseFeeder>(new WasmNoiseFeeder());
    const particleFeederRef = useRef<WasmParticleFeeder>(new WasmParticleFeeder());

    // Cinematic camera FX gate (DOF + motion blur). Quality and the reduced-motion
    // preference are read once — both require a reload to change — while speed is
    // polled per frame from the car/cruise loops. See cinematicCameraFx.ts.
    const qualityRef = useRef(getActiveQualityLevel());
    const reducedMotionRef = useRef(prefersReducedMotion());

    const currentRendererRef = internalRendererRef;

    // The frame loop. Created once; its inputs are written below on render.
    const driverRef = useRef<FrameDriver | null>(null);
    if (!driverRef.current) {
        driverRef.current = new FrameDriver({
            quality: qualityRef.current,
            bootReducedMotion: reducedMotionRef.current,
            outputCanvas: () => canvasRef.current,
            noiseFeeder: noiseFeederRef.current,
            wasmNoiseEnabled: getWasmNoisePreference(),
            particleFeeder: particleFeederRef.current,
            wasmParticlesEnabled: getWasmParticlePreference(),
        });
    }
    const driver = driverRef.current;

    // Live inputs, written on render so the next frame sees them without a
    // commit round-trip (the hold flag especially — see note 2 above).
    const sourceRef = useRef(source);
    sourceRef.current = source;
    driver.panoramaUpdatePaused = isPanoramaUpdatePaused;
    driver.autoExposureEnabled = autoExposureEnabled;

    // Device lost reinit counter
    const [reinitCounter, setReinitCounter] = useState(0);
    const [rendererReadyTick, setRendererReadyTick] = useState(0);
    // Capped, backed-off re-init after a genuine device loss; terminal overlay when spent.
    const lossRecoveryRef = useRef(new DeviceLossRecovery());
    const reinitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [gpuUnavailable, setGpuUnavailable] = useState(false);

    /** Resolve the backing store from the last observed box and the device's texture limit. */
    const applyBackingStore = useCallback(() => {
        const box = canvasBoxRef.current;
        if (!box) return;
        const next = resolveBackingStoreSize({
            ...box,
            devicePixelRatio: window.devicePixelRatio || 1,
            dprCap: dprCapForPixelRatio(PRESETS[qualityRef.current].pixelRatio),
            maxTextureDimension:
                internalRendererRef.current?.getMaxTextureDimension2D?.() ?? DEFAULT_MAX_TEXTURE_DIMENSION,
        });
        setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    }, []);

    // Size and DPR changes (window resize, zoom, moving between monitors).
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const stop = observeCanvasBox(canvas, (box) => {
            const first = canvasBoxRef.current === null;
            canvasBoxRef.current = box;
            if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
            if (first) {
                applyBackingStore();
                return;
            }
            resizeTimeoutRef.current = setTimeout(() => {
                resizeTimeoutRef.current = null;
                applyBackingStore();
            }, 150);
        });
        return () => {
            stop();
            if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
        };
    }, [applyBackingStore]);

    // The device's real texture limit is only known once a renderer exists.
    useEffect(() => {
        applyBackingStore();
    }, [rendererReadyTick, applyBackingStore]);

    useEffect(() => () => {
        if (reinitTimerRef.current) clearTimeout(reinitTimerRef.current);
    }, []);

    // Latest environment settings for the frame driver.
    useEffect(() => {
        driver.env = {
            nightIntensity, rainIntensity, snowIntensity, wind, fogDensity,
            vibrance, saturation, contrast, exposure, temperature, tint,
            headlightsOn, highBeam, domeLightOn,
            sunAzimuth, sunAltitude, moonAzimuth, moonAltitude,
            shaderEffectsEnabled, timeOfDay
        };
    }, [
        nightIntensity, rainIntensity, snowIntensity, wind, fogDensity,
        vibrance, saturation, contrast, exposure, temperature, tint,
        headlightsOn, highBeam, domeLightOn,
        sunAzimuth, sunAltitude, moonAzimuth, moonAltitude,
        shaderEffectsEnabled, timeOfDay, driver,
    ]);

    // Use refs for callbacks to avoid reinit when they change
    const onWebGPUStatusRef = useRef(onWebGPUStatus);
    const onBackendInfoRef = useRef(onBackendInfo);
    useEffect(() => { onWebGPUStatusRef.current = onWebGPUStatus; }, [onWebGPUStatus]);
    useEffect(() => { onBackendInfoRef.current = onBackendInfo; }, [onBackendInfo]);

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;

        let isActive = true;
        let activeRenderer: StreetViewRenderer | null = null;

        const recovery = lossRecoveryRef.current;
        /** Re-init after `delayMs`, or give up for good — never a tight loop. */
        const scheduleRecovery = (decision: ReturnType<DeviceLossRecovery['onDeviceLost']>) => {
            if (decision.action === 'give-up') {
                console.error(`[WebGPU] GPU unavailable after ${decision.attempts} re-init attempt(s).`);
                setGpuUnavailable(true);
                onWebGPUStatusRef.current?.(false);
                return;
            }
            console.warn(`[WebGPU] Re-init attempt ${decision.attempt} in ${decision.delayMs} ms`);
            if (reinitTimerRef.current) clearTimeout(reinitTimerRef.current);
            reinitTimerRef.current = setTimeout(() => {
                reinitTimerRef.current = null;
                setReinitCounter(c => c + 1);
            }, decision.delayMs);
        };

        (async () => {
            const result = await createStreetViewRenderer(canvas, {
                // Only a loss we did not cause arrives here: the renderer
                // suppresses the `lost` of a device it destroyed itself.
                onLost: (info) => {
                    console.warn('[WebGPU] Device lost:', info);
                    if (isActive) {
                        scheduleRecovery(recovery.onDeviceLost());
                    }
                }
            });
            if (!isActive) {
                result.renderer?.destroy();
                return;
            }
            if (result.renderer) {
                recovery.onBootSucceeded();
                activeRenderer = result.renderer;
                internalRendererRef.current = result.renderer;
                driver.renderer = result.renderer;
                setRendererReadyTick((tick) => tick + 1);
                // The compute weather path gets the fBm turbulence tile
                // (WASM fill_fbm_buffer); the fragment default keeps the
                // single-octave tile so its output is unchanged.
                noiseFeederRef.current.setDetail(
                    result.renderer.getWeatherPostProcessMode?.() === 'compute' ? 'fbm' : 'classic'
                );
                setRenderer(result.renderer);  // Register with StreetView context
                result.renderer.setSamplerAnisotropy?.(qualityRef.current);
                result.renderer.setTemporalHistoryEnabled?.(
                    isCinematicQuality(qualityRef.current) && !reducedMotionRef.current
                );
                onWebGPUStatusRef.current?.(true);
                onBackendInfoRef.current?.({ backendType: result.backendType, fallbackReason: result.fallbackReason });
                console.info(
                    `[Renderer] ${result.backendType} renderer active` +
                    (result.fallbackReason ? ` (${result.fallbackReason})` : '')
                );
            } else if (recovery.isRecovering()) {
                // A re-init after a loss failed to boot: back off and retry, or give up.
                scheduleRecovery(recovery.onReinitFailed());
            } else {
                console.warn(
                    'WebGPU renderer initialization failed. Hard-fail — add ?webgl2=1 for the WebGL2 fallback.',
                    result.fallbackReason || '',
                );
                onWebGPUStatusRef.current?.(false);
                onBackendInfoRef.current?.({ backendType: null, fallbackReason: result.fallbackReason });
            }
        })();

        return () => {
            isActive = false;
            setRenderer(null);  // Unregister from StreetView context
            if (driver.renderer === activeRenderer) driver.renderer = null;
            if (internalRendererRef.current === activeRenderer) internalRendererRef.current = null;
            activeRenderer?.destroy();
        };
    }, [reinitCounter, setRenderer, driver]);

    useEffect(() => {
        const renderer = internalRendererRef.current;
        if (!renderer?.setLookLut) return;
        let cancelled = false;
        void fetchLookLutVolume(activeLookId, qualityRef.current).then((volume) => {
            if (cancelled) return;
            renderer.setLookLut?.(volume);
        });
        return () => {
            cancelled = true;
        };
    }, [activeLookId, reinitCounter, rendererReadyTick]);

    // Resize renderer when the backing store changes
    useEffect(() => {
        if (currentRendererRef.current) {
            currentRendererRef.current.resize(size.width, size.height);
        }
    }, [size.width, size.height, currentRendererRef]);

    const stopEvent = (e: React.SyntheticEvent) => e.stopPropagation();

    // The frame loop runs for the component's lifetime; renderer re-inits
    // (device loss) swap `driver.renderer` underneath it.
    useEffect(() => {
        driver.source = { element: () => sourceRef.current };
        driver.start();
        return () => driver.stop();
    }, [driver]);

    return (
        <>
        <canvas
            ref={canvasRef}
            width={size.width}
            height={size.height}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: 0,
                display: 'block',
                border: 'none',
                marginTop: 0,
                borderRadius: 0,
                // GPU transition shader handles visual continuity — always opaque
                opacity: 1
            }}
        />
        {gpuUnavailable && (
            // Terminal state after capped re-init attempts. Swallows input so
            // the window-level free-look / car handlers never see it.
            <div
                role="alert"
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                onWheel={stopEvent}
                onKeyDown={stopEvent}
                onTouchStart={stopEvent}
                style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.85)',
                    color: '#fff',
                    font: '15px system-ui, sans-serif',
                    textAlign: 'center',
                    padding: 16,
                }}
            >
                <div>
                    <p style={{ margin: '0 0 12px' }}>
                        GPU unavailable — the graphics device was lost and could not be restored.
                    </p>
                    <button type="button" onClick={() => window.location.reload()}>
                        Reload
                    </button>
                </div>
            </div>
        )}
        </>
    );
};

export default WebGPUCanvas;
