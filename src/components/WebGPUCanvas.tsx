import React, { useRef, useEffect, useState } from 'react';
import { createStreetViewRenderer } from '../renderer/createStreetViewRenderer';
import { RendererBackendType, StreetViewRenderer } from '../renderer/RendererBackend';
import { usePerformanceMonitor, useEnvironmentSettings, useStreetView } from '../hooks';
import { getMemoryProfiler } from '../utils/memoryProfiler';
import { streetViewProbe } from '../utils/streetViewProbe';
import { shouldBypassAdaptiveSkip, shouldRenderHeldFrameThisTick } from './holdRenderLoop';

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
        shaderEffectsEnabled, timeOfDay
    } = useEnvironmentSettings();

    // Get street view state
    const {
        canvas: source,
        heading,
        pitch,
        zoom,
        isTransitioning: isStreetViewTransitioning,
        isPanoramaUpdatePaused,
        setRenderer,
    } = useStreetView();

    // State to track window size for full-screen rendering
    const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

    // Performance: Frame skipping state
    const frameCountRef = useRef<number>(0);
    const lastSourceRef = useRef<CanvasImageSource | null | undefined>(undefined);
    const sourceChangeFlagRef = useRef<boolean>(true);
    const FRAME_SKIP = 2; // Render every 2nd frame (30fps base) when source unchanged, 60fps when changed

    // Performance: Debounced resize
    const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    const headingRef = useRef(heading);
    const pitchRef = useRef(pitch);
    const zoomRef = useRef(zoom);
    const sourceRef = useRef(source);
    const isPanoramaUpdatePausedRef = useRef(isPanoramaUpdatePaused);
    const isTransitioningRef = useRef(isStreetViewTransitioning);
    const shouldSkipFrameRef = useRef(shouldSkipFrame);

    headingRef.current = heading;
    pitchRef.current = pitch;
    zoomRef.current = zoom;
    sourceRef.current = source;
    isPanoramaUpdatePausedRef.current = isPanoramaUpdatePaused;
    isTransitioningRef.current = isStreetViewTransitioning;
    shouldSkipFrameRef.current = shouldSkipFrame;

    // Memory profiling
    useEffect(() => {
        const memoryProfiler = getMemoryProfiler();
        const interval = setInterval(() => {
            memoryProfiler.snapshot();
        }, 5000); // Snapshot every 5 seconds
        
        return () => clearInterval(interval);
    }, []);

    // Handle window resize - debounced for performance
    useEffect(() => {
        const handleResize = () => {
            if (resizeTimeoutRef.current) {
                clearTimeout(resizeTimeoutRef.current);
            }
            resizeTimeoutRef.current = setTimeout(() => {
                setSize({ width: window.innerWidth, height: window.innerHeight });
            }, 150); // 150ms debounce
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            if (resizeTimeoutRef.current) {
                clearTimeout(resizeTimeoutRef.current);
            }
        };
    }, []);

    // Device lost reinit counter
    const [reinitCounter, setReinitCounter] = useState(0);
    
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

        (async () => {
            const result = await createStreetViewRenderer(canvas, {
                onLost: (info) => {
                    console.warn('[WebGPU] Device lost:', info);
                    if (isActive) {
                        setReinitCounter(c => c + 1);
                    }
                }
            });
            if (!isActive) {
                result.renderer?.destroy();
                return;
            }
            if (result.renderer) {
                activeRenderer = result.renderer;
                internalRendererRef.current = result.renderer;
                setRenderer(result.renderer);  // Register with StreetView context
                onWebGPUStatusRef.current?.(true);
                onBackendInfoRef.current?.({ backendType: result.backendType, fallbackReason: result.fallbackReason });
                startMonitoringRef.current();
                console.info(
                    `[Renderer] ${result.backendType} renderer active` +
                    (result.fallbackReason ? ` (${result.fallbackReason})` : '')
                );
            } else {
                console.warn("Renderer initialization failed. Raw Street View fallback active.");
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
        // Ignore live canvas swaps while the outgoing frame is held — they are loading artifacts.
        if (isPanoramaUpdatePaused) return;
        if (source !== lastSourceRef.current) {
            sourceChangeFlagRef.current = true;
            lastSourceRef.current = source;
        }
    }, [source, isPanoramaUpdatePaused]);

    // Resize renderer when canvas size changes
    useEffect(() => {
        if (currentRendererRef.current) {
            currentRendererRef.current.resize(size.width, size.height);
        }
    }, [size.width, size.height, currentRendererRef]);

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;

            const panoramaUpdatePaused = isPanoramaUpdatePausedRef.current;
            const isTransitioning = isTransitioningRef.current;
            const skipFrame = shouldBypassAdaptiveSkip(panoramaUpdatePaused, isTransitioning)
                ? false
                : shouldSkipFrameRef.current();

            const renderHeading = headingRef.current;
            const renderPitch = pitchRef.current;
            const renderZoom = zoomRef.current;
            const liveSource = sourceRef.current;

            const shouldRender = shouldRenderHeldFrameThisTick({
                panoramaUpdatePaused,
                skipFrame,
                isTransitioning,
                sourceChanged: sourceChangeFlagRef.current,
                frameCount: frameCountRef.current,
                frameSkip: FRAME_SKIP,
            });

            // Google Maps canvas already reflects heading/pitch via setPov — pass through
            // directly so the WebGPU view matches what you see through the windows.
            const weatherHeading = (((renderHeading % 360) + 360) % 360) / 360;
            const weatherPitch = (renderPitch + 90) / 180;

            if (currentRendererRef.current) {
                // Build and upload weather params every frame BEFORE rendering
                const e = envRef.current;
                const params = new Float32Array(40);

                // [0-5]: Color grading
                params[0] = e.vibrance - 1.0;
                params[1] = e.saturation - 1.0;
                params[2] = e.contrast - 1.0;
                params[3] = e.exposure;
                params[4] = e.temperature;
                params[5] = e.tint;

                // [6-10]: Animation time, rain, snow, wind, speed
                params[6] = (Date.now() - timeRef.current) / 1000.0;
                params[7] = (e.rainIntensity / 100.0) * 2.0;   // UI 0-100 -> shader 0-2
                params[8] = (e.snowIntensity / 100.0) * 2.0;   // UI 0-100 -> shader 0-2
                params[9] = (e.wind / 100.0) * 2.0 - 1.0;      // UI 0-100 -> shader -1 to +1
                params[10] = 1.0;

                // [11-15]: Night mode and headlights
                params[11] = e.nightIntensity;
                params[12] = e.headlightsOn ? 1.0 : 0.0;
                params[13] = e.highBeam ? 1.0 : 0.0;
                params[14] = 0.5;
                params[15] = 0.5;

                // [16-17]: Dome light
                params[16] = e.domeLightOn ? 1.0 : 0.0;
                params[17] = e.domeLightOn ? 0.5 : 0.0;

                // [18-21]: Astronomy
                params[18] = e.sunAzimuth;
                params[19] = e.sunAltitude;
                params[20] = e.moonAzimuth;
                params[21] = e.moonAltitude;

                // [22-31]: Atmospheric effects
                params[22] = e.fogDensity / 100.0;        // fog intensity (same as density, from single fog slider)
                params[23] = e.fogDensity / 100.0;        // fog density (0-1)
                params[24] = 0.0;                         // fog height
                params[25] = 0.0;                         // fog color index
                // Light shafts and lens flare activate when the sun is above the horizon
                const sunVisible = e.sunAltitude > 0 ? Math.min(e.sunAltitude / 0.3, 1.0) : 0.0;
                params[26] = sunVisible * 0.5;            // light shafts intensity
                params[27] = 0.0;                         // heat shimmer intensity
                params[28] = sunVisible * 0.4;            // lens flare intensity
                params[29] = 0.0;                         // chromatic aberration
                params[30] = 0.0;                         // dust intensity
                params[31] = 0.0;                         // humidity haze

                // [32]: Shader effects enabled flag
                params[32] = e.shaderEffectsEnabled ? 1.0 : 0.0;

                // [33-35]: Camera params and padding
                params[33] = weatherHeading;
                params[34] = weatherPitch;
                params[35] = 0.0;

                // [36]: Sunrise flag
                params[36] = e.timeOfDay === 'sunrise' ? 1.0 : 0.0;

                // [37]: anamorphicStreak — activates with lens flare when sun is visible
                params[37] = sunVisible * 0.5;
                // [38-39]: padding
                params[38] = 0.0;
                params[39] = 0.0;

                currentRendererRef.current.updateWeatherParams(params);
                currentRendererRef.current.updateCameraParams(weatherHeading, weatherPitch);
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
    }, []);

    return (
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
    );
};

export default WebGPUCanvas;
