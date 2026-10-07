import React, { useRef, useEffect, useState, useCallback } from 'react';
import { povStore } from '../state/povStore';
import { createStreetViewRenderer } from '../renderer/createStreetViewRenderer';
import { RendererBackendType, StreetViewRenderer } from '../renderer/RendererBackend';
import { packWeatherParams } from '../renderer/packWeatherParams';
import { WeatherParamIndex } from '../renderer/weatherUniformLayout';
import { usePerformanceMonitor, useEnvironmentSettings, useStreetView } from '../hooks';
import { getMemoryProfiler } from '../utils/memoryProfiler';
import { streetViewProbe } from '../utils/streetViewProbe';
import { shouldBypassAdaptiveSkip, shouldRenderHeldFrameThisTick } from './holdRenderLoop';
import { WasmNoiseFeeder, getWasmNoisePreference } from '../wasm/wasmNoiseFeeder';
import { WasmParticleFeeder, getWasmParticlePreference } from '../wasm/wasmParticleFeeder';
import { getActiveQualityLevel, PRESETS } from '../config/visualPresets';
import { resolveCinematicCameraFx, prefersReducedMotion, isCinematicQuality } from '../renderer/cinematicCameraFx';
import { fetchLookLutVolume } from '../renderer/lut';
import { getCameraSpeedNormalized } from '../renderer/cameraMotionSignal';
import { getGpuChoresStats } from '../renderer/gpuChores/gpuChoresStatsStore';
import {
    AUTO_EXPOSURE_IDLE,
    resolveAutoExposureFrame,
    setAutoExposureStatus,
    type AutoExposureFrameState,
} from '../renderer/autoExposure';
import {
    HORIZON_IDLE,
    resolveHorizonFrame,
    type HorizonFrameState,
} from '../renderer/gpuChores/horizonEstimate';
import { DeviceLossRecovery } from '../renderer/deviceLossRecovery';
import {
    DEFAULT_MAX_TEXTURE_DIMENSION,
    dprCapForPixelRatio,
    observeCanvasBox,
    resolveBackingStoreSize,
    type CanvasBoxSize,
} from './canvasBackingStore';
import {
    isParticlePrecipitationEnabled,
    particleGridForQuality,
    particleCountForGrid,
    PARTICLE_SEED,
} from '../renderer/weatherParticles';

/**
 * ⚠️ CRITICAL INTEGRATION NOTES - DO NOT REMOVE ⚠️
 * 1. WEATHER SYNC: This canvas MUST actively read `useEnvironmentSettings()` 
 *    and pass values into `renderer.updateWeatherParams()` inside the render loop. 
 *    If disconnected, the UI sliders will move but shaders will not react.
 * 2. CRUISE PAUSE: While `isPanoramaUpdatePaused`, WebGPUCanvas calls
 *    `renderHeldFrame()` so the GPU snapshot is drawn without uploading the
 *    loading Google Maps canvas.
 */

interface WebGPUCanvasProps {
    onWebGPUStatus?: (available: boolean) => void;
    onBackendInfo?: (info: { backendType: RendererBackendType | null; fallbackReason?: string }) => void;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ onWebGPUStatus, onBackendInfo }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const internalRendererRef = useRef<StreetViewRenderer | null>(null);
    const animationFrameId = useRef<number>(0);
    
    // Get environment settings from React context
    const {
        nightIntensity, rainIntensity, snowIntensity, wind, fogDensity,
        vibrance, saturation, contrast, exposure, temperature, tint,
        headlightsOn, highBeam, domeLightOn,
        sunAzimuth, sunAltitude, moonAzimuth, moonAltitude, moonIntensity,
        shaderEffectsEnabled, timeOfDay, activeLookId, autoExposureEnabled
    } = useEnvironmentSettings();

    // Get street view state
    const {
        canvas: source,
        isTransitioning: isStreetViewTransitioning,
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

    // Performance: Frame skipping state
    const frameCountRef = useRef<number>(0);
    const lastSourceRef = useRef<CanvasImageSource | null | undefined>(undefined);
    const sourceChangeFlagRef = useRef<boolean>(true);
    const FRAME_SKIP = 2; // Render every 2nd frame (30fps base) when source unchanged, 60fps when changed

    // Performance: debounced resize — every backing-store change reallocates
    // the intermediate (and the compute weather targets), so a drag-resize
    // settles before it is applied. The first observation applies at once.
    const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // WASM-driven ambient dust turbulence (see src/wasm/wasmNoiseFeeder.ts).
    // ?wasmNoise=off (or a stored streetview.wasmNoise=off preference) disables it.
    const noiseFeederRef = useRef<WasmNoiseFeeder>(new WasmNoiseFeeder());
    const wasmNoiseEnabledRef = useRef<boolean>(getWasmNoisePreference());
    const particleFeederRef = useRef<WasmParticleFeeder>(new WasmParticleFeeder());
    const wasmParticlesEnabledRef = useRef<boolean>(getWasmParticlePreference());

    // Cinematic camera FX gate (DOF + motion blur). Quality and the reduced-motion
    // preference are read once — both require a reload to change — while speed is
    // polled per frame from the car/cruise loops. See cinematicCameraFx.ts.
    const qualityRef = useRef(getActiveQualityLevel());
    const reducedMotionRef = useRef(prefersReducedMotion());

    const currentRendererRef = internalRendererRef;

    // Performance monitoring
    const { startMonitoring, stopMonitoring, shouldSkipFrame } = usePerformanceMonitor({
        targetFPS: 60,
        sampleSize: 60,
        warningThreshold: 45,
        criticalThreshold: 30,
        enableAdaptiveQuality: true
    });

    // Dynamic inputs for the RAF loop — synced every render so animate() always
    // reads the latest values without tearing down requestAnimationFrame.
    const sourceRef = useRef(source);
    const isPanoramaUpdatePausedRef = useRef(isPanoramaUpdatePaused);
    const isTransitioningRef = useRef(isStreetViewTransitioning);
    const shouldSkipFrameRef = useRef(shouldSkipFrame);

    sourceRef.current = source;
    isPanoramaUpdatePausedRef.current = isPanoramaUpdatePaused;
    isTransitioningRef.current = isStreetViewTransitioning;
    shouldSkipFrameRef.current = shouldSkipFrame;

    // Auto exposure (opt-in): eases the GpuChores luma hint into the exposure
    // uniform. Frozen through hold-pause; see renderer/autoExposure.ts.
    const autoExposureEnabledRef = useRef(autoExposureEnabled);
    autoExposureEnabledRef.current = autoExposureEnabled;
    const autoExposureStateRef = useRef<AutoExposureFrameState>(AUTO_EXPOSURE_IDLE);
    const lastFrameMsRef = useRef<number | null>(null);

    // Image-derived horizon: blends the pitch-only depth-proxy horizon toward
    // a row-luma estimate (preset weight; 0 = today's horizon). Frozen through
    // hold-pause; see renderer/gpuChores/horizonEstimate.ts.
    const horizonStateRef = useRef<HorizonFrameState>(HORIZON_IDLE);

    // Memory profiling
    useEffect(() => {
        const memoryProfiler = getMemoryProfiler();
        const interval = setInterval(() => {
            memoryProfiler.snapshot();
        }, 5000); // Snapshot every 5 seconds
        
        return () => clearInterval(interval);
    }, []);

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

    // Keep latest environment settings in a ref for the render loop
    const envRef = useRef({
        nightIntensity, rainIntensity, snowIntensity, wind, fogDensity,
        vibrance, saturation, contrast, exposure, temperature, tint,
        headlightsOn, highBeam, domeLightOn,
        sunAzimuth, sunAltitude, moonAzimuth, moonAltitude, moonIntensity,
        shaderEffectsEnabled, timeOfDay
    });

    // Page-relative time to avoid f32 precision loss in shader sin()/hash()
    const timeRef = useRef(Date.now());
    useEffect(() => {
        envRef.current = {
            nightIntensity, rainIntensity, snowIntensity, wind, fogDensity,
            vibrance, saturation, contrast, exposure, temperature, tint,
            headlightsOn, highBeam, domeLightOn,
            sunAzimuth, sunAltitude, moonAzimuth, moonAltitude, moonIntensity,
            shaderEffectsEnabled, timeOfDay
        };
    }, [
        nightIntensity, rainIntensity, snowIntensity, wind, fogDensity,
        vibrance, saturation, contrast, exposure, temperature, tint,
        headlightsOn, highBeam, domeLightOn,
        sunAzimuth, sunAltitude, moonAzimuth, moonAltitude, moonIntensity,
        shaderEffectsEnabled, timeOfDay
    ]);

    // Use refs for callbacks to avoid reinit when they change
    const onWebGPUStatusRef = useRef(onWebGPUStatus);
    const onBackendInfoRef = useRef(onBackendInfo);
    const startMonitoringRef = useRef(startMonitoring);
    const stopMonitoringRef = useRef(stopMonitoring);
    useEffect(() => { onWebGPUStatusRef.current = onWebGPUStatus; }, [onWebGPUStatus]);
    useEffect(() => { onBackendInfoRef.current = onBackendInfo; }, [onBackendInfo]);
    useEffect(() => { startMonitoringRef.current = startMonitoring; }, [startMonitoring]);
    useEffect(() => { stopMonitoringRef.current = stopMonitoring; }, [stopMonitoring]);

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
                startMonitoringRef.current();
                console.info(
                    `[Renderer] ${result.backendType} renderer active` +
                    (result.fallbackReason ? ` (${result.fallbackReason})` : '')
                );
            } else if (recovery.isRecovering()) {
                // A re-init after a loss failed to boot: back off and retry, or give up.
                scheduleRecovery(recovery.onReinitFailed());
            } else {
                console.warn(
                    'WebGPU renderer initialization failed. Hard-fail — no live GL weather.',
                    result.fallbackReason || '',
                );
                onWebGPUStatusRef.current?.(false);
                onBackendInfoRef.current?.({ backendType: null, fallbackReason: result.fallbackReason });
            }
        })();

        return () => {
            isActive = false;
            setRenderer(null);  // Unregister from StreetView context
            stopMonitoringRef.current();
            activeRenderer?.destroy();
        };
    }, [reinitCounter, setRenderer]);

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

    useEffect(() => {
        // Ignore live canvas swaps while the outgoing frame is held — they are loading artifacts.
        if (isPanoramaUpdatePaused) return;
        if (source !== lastSourceRef.current) {
            sourceChangeFlagRef.current = true;
            lastSourceRef.current = source;
        }
    }, [source, isPanoramaUpdatePaused]);

    // Resize renderer when the backing store changes
    useEffect(() => {
        if (currentRendererRef.current) {
            currentRendererRef.current.resize(size.width, size.height);
        }
    }, [size.width, size.height, currentRendererRef]);

    const stopEvent = (e: React.SyntheticEvent) => e.stopPropagation();

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;

            const panoramaUpdatePaused = isPanoramaUpdatePausedRef.current;
            const isTransitioning = isTransitioningRef.current;
            // In car mode the cabin is drawn into this frame rather than
            // stacked over it in CSS (`renderer/cabinComposite.ts`), so a
            // skipped road frame would also freeze the cabin.
            const cabinComposited =
                currentRendererRef.current?.isCabinCompositedInFrame?.() === true;
            const skipFrame = shouldBypassAdaptiveSkip(
                panoramaUpdatePaused,
                isTransitioning,
                cabinComposited,
            )
                ? false
                : shouldSkipFrameRef.current();

            const pov = povStore.get();
            const renderHeading = pov.heading;
            const renderPitch = pov.pitch;
            const renderZoom = pov.zoom;
            const liveSource = sourceRef.current;

            const shouldRender = shouldRenderHeldFrameThisTick({
                panoramaUpdatePaused,
                skipFrame,
                isTransitioning,
                sourceChanged: sourceChangeFlagRef.current,
                frameCount: frameCountRef.current,
                frameSkip: FRAME_SKIP,
                cabinComposited,
            });

            // Google Maps canvas already reflects heading/pitch via setPov — pass through
            // directly so the WebGPU view matches what you see through the windows.
            const weatherHeading = (((renderHeading % 360) + 360) % 360) / 360;
            const weatherPitch = (renderPitch + 90) / 180;

            if (currentRendererRef.current) {
                // Build and upload weather params every frame BEFORE rendering
                const e = envRef.current;
                const wasmNoiseActive = wasmNoiseEnabledRef.current && noiseFeederRef.current.isReady;
                const holdActive = panoramaUpdatePaused || currentRendererRef.current.isHoldActive();
                const choresStats = getGpuChoresStats();
                const horizon = resolveHorizonFrame({
                    weight: PRESETS[qualityRef.current].horizonEstimateBlend,
                    holdActive,
                    rows: choresStats.rowLuma,
                    rowsPitch: choresStats.rowLumaPitch,
                    rowsSeq: choresStats.rowLumaSeq,
                    livePitch: weatherPitch,
                }, horizonStateRef.current);
                horizonStateRef.current = horizon.state;
                const params = packWeatherParams({
                    env: e,
                    timeSeconds: (Date.now() - timeRef.current) / 1000.0,
                    cameraHeading: weatherHeading,
                    cameraPitch: weatherPitch,
                    wasmNoiseActive,
                    cinematic: resolveCinematicCameraFx({
                        quality: qualityRef.current,
                        reducedMotion: reducedMotionRef.current,
                        speedNormalized: getCameraSpeedNormalized(),
                    }),
                    horizon: horizon.uniforms,
                });

                const nowMs = performance.now();
                const dtMs = lastFrameMsRef.current == null ? 0 : nowMs - lastFrameMsRef.current;
                lastFrameMsRef.current = nowMs;
                const ae = resolveAutoExposureFrame({
                    enabled: autoExposureEnabledRef.current,
                    holdActive,
                    meanLuma: choresStats.meanLuma,
                    manualExposure: e.exposure,
                    dtMs,
                    reducedMotion: reducedMotionRef.current
                        || (typeof document !== 'undefined'
                            && document.body.classList.contains('reduced-motion')),
                }, autoExposureStateRef.current);
                autoExposureStateRef.current = ae.state;
                if (ae.exposure != null) params[WeatherParamIndex.exposure] = ae.exposure;
                setAutoExposureStatus({
                    enabled: autoExposureEnabledRef.current,
                    appliedEv: ae.exposure,
                    holdActive,
                });

                currentRendererRef.current.updateWeatherParams(params);
                currentRendererRef.current.updateCameraParams(weatherHeading, weatherPitch);

                if (wasmNoiseEnabledRef.current) {
                    const tile = noiseFeederRef.current.sampleTile(
                        frameCountRef.current,
                        params[WeatherParamIndex.time]!
                    );
                    if (tile) currentRendererRef.current.updateNoiseBuffer(tile);
                }

                if (
                    wasmParticlesEnabledRef.current
                    && isParticlePrecipitationEnabled({
                        weatherMode: currentRendererRef.current.getWeatherPostProcessMode?.() ?? 'fragment',
                        quality: qualityRef.current,
                        preference: true,
                        reducedMotion: reducedMotionRef.current,
                    })
                ) {
                    const grid = particleGridForQuality(qualityRef.current, reducedMotionRef.current);
                    const precipActive = e.rainIntensity + e.snowIntensity > 0.001;
                    const seeds = particleFeederRef.current.sampleSeeds(
                        particleCountForGrid(grid),
                        precipActive,
                        PARTICLE_SEED,
                    );
                    if (seeds) {
                        currentRendererRef.current.updateParticleSeeds(seeds, grid.width, grid.height);
                    }
                }
            }

            if (shouldRender && currentRendererRef.current) {
                const renderer = currentRendererRef.current;
                const holding = panoramaUpdatePaused || renderer.isHoldActive();
                if (holding) {
                    renderer.renderHeldFrame(renderHeading, renderPitch, renderZoom);
                    if (canvasRef.current) streetViewProbe.checkPixelDrift(canvasRef.current);
                } else if (liveSource) {
                    renderer.renderStreetView('streetview', liveSource, renderHeading, renderPitch, renderZoom);
                } else {
                    renderer.renderWeatherOnly();
                }
                sourceChangeFlagRef.current = false;
                if (!holding && frameCountRef.current % 8 === 0) {
                    renderer.samplePanoramaStats?.({
                        horizonRows: PRESETS[qualityRef.current].horizonEstimateBlend > 0,
                        pitch: (renderPitch + 90) / 180,
                    });
                }
            } else if (currentRendererRef.current) {
                currentRendererRef.current.updateWeatherAnimation();
                if (panoramaUpdatePaused || currentRendererRef.current.isHoldActive()) {
                    currentRendererRef.current.renderHeldFrame(renderHeading, renderPitch, renderZoom);
                    if (canvasRef.current) streetViewProbe.checkPixelDrift(canvasRef.current);
                }
            }

            frameCountRef.current++;
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => {
            active = false;
            cancelAnimationFrame(animationFrameId.current);
        };
    }, [currentRendererRef]);

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
