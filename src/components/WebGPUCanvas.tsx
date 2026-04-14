import React, { useRef, useEffect, useState } from 'react';
import { Renderer } from '../renderer/Renderer';
import { usePerformanceMonitor, useEnvironmentSettings, useStreetView, useViewMode } from '../hooks';
import { getMemoryProfiler } from '../utils/memoryProfiler';

/**
 * ⚠️ CRITICAL INTEGRATION NOTES - DO NOT REMOVE ⚠️
 * 1. WEATHER SYNC: This canvas MUST actively read `useEnvironmentSettings()` 
 *    and pass values into `renderer.updateWeatherParams()` inside the render loop. 
 *    If disconnected, the UI sliders will move but shaders will not react.
 * 2. CRUISE PAUSE: This canvas relies on `useStreetView().isTransitioning` to fade 
 *    opacity to 0 during node advances. This hides Google Maps tile-tearing when 
 *    the panorama is loading a new location.
 */

interface WebGPUCanvasProps {
    onWebGPUStatus?: (available: boolean) => void;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ onWebGPUStatus }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const internalRendererRef = useRef<Renderer | null>(null);
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
    const { canvas: source, heading, zoom, isTransitioning: isStreetViewTransitioning } = useStreetView();

    // Get view mode
    const { viewMode, carHeading } = useViewMode();

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
    const [webgpuFailed, setWebgpuFailed] = useState(false);
    
    // Keep latest environment settings in a ref for the render loop
    const envRef = useRef({
        nightIntensity, rainIntensity, snowIntensity, wind, fogDensity,
        vibrance, saturation, contrast, exposure, temperature, tint,
        headlightsOn, highBeam, domeLightOn,
        sunAzimuth, sunAltitude, moonAzimuth, moonAltitude, moonIntensity,
        shaderEffectsEnabled, timeOfDay
    });
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
    const startMonitoringRef = useRef(startMonitoring);
    const stopMonitoringRef = useRef(stopMonitoring);
    useEffect(() => { onWebGPUStatusRef.current = onWebGPUStatus; }, [onWebGPUStatus]);
    useEffect(() => { startMonitoringRef.current = startMonitoring; }, [startMonitoring]);
    useEffect(() => { stopMonitoringRef.current = stopMonitoring; }, [stopMonitoring]);

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);

        let isActive = true;

        (async () => {
            const success = await renderer.init({
                onLost: (info) => {
                    console.warn('[WebGPU] Device lost:', info);
                    if (isActive) {
                        setReinitCounter(c => c + 1);
                    }
                }
            });
            if (!isActive) return;
            if (success) {
                internalRendererRef.current = renderer;
                setWebgpuFailed(false);
                onWebGPUStatusRef.current?.(true);
                startMonitoringRef.current();
            } else {
                console.warn("WebGPU initialization failed. Please check your browser compatibility.");
                setWebgpuFailed(true);
                onWebGPUStatusRef.current?.(false);
            }
        })();

        return () => {
            isActive = false;
            stopMonitoringRef.current();
            renderer.destroy();
        };
    }, [reinitCounter]);

    useEffect(() => {
        // Performance: Track source changes
        if (source !== lastSourceRef.current) {
            sourceChangeFlagRef.current = true;
            lastSourceRef.current = source;
        }
    }, [source]);

    // Resize renderer when canvas size changes
    useEffect(() => {
        if (currentRendererRef.current) {
            currentRendererRef.current.resize(size.width, size.height);
        }
    }, [size.width, size.height]);

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;

            // Performance: Adaptive frame skipping based on quality
            const skipFrame = shouldSkipFrame();
            
            const shouldRender = !skipFrame && (sourceChangeFlagRef.current || (frameCountRef.current % FRAME_SKIP === 0));

            // Calculate camera params based on current view mode
            const isCarMode = viewMode === 'car';
            const headYawOffset = ((heading - carHeading + 540) % 360) - 180;
            const currentPanX = isCarMode ? 0.5 - (headYawOffset / 90.0) * 0.5 : 0.5;
            const currentPanY = 0.5;
            const renderHeading = currentPanX * 360;
            const renderPitch = currentPanY * 180 - 90;

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
                params[6] = Date.now() / 1000.0;
                params[7] = e.rainIntensity;
                params[8] = e.snowIntensity;
                params[9] = e.wind;
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
                params[22] = 0.0;                         // fog intensity
                params[23] = e.fogDensity / 100.0;        // fog density (0-1)
                params[24] = 0.0;                         // fog height
                params[25] = 0.0;                         // fog color index
                params[26] = 0.0;                         // light shafts intensity
                params[27] = 0.0;                         // heat shimmer intensity
                params[28] = 0.0;                         // lens flare intensity
                params[29] = 0.0;                         // chromatic aberration
                params[30] = 0.0;                         // dust intensity
                params[31] = 0.0;                         // humidity haze

                // [32]: Shader effects enabled flag
                params[32] = e.shaderEffectsEnabled ? 1.0 : 0.0;

                // [33-35]: Camera params and padding
                params[33] = currentPanX;
                params[34] = currentPanY;
                params[35] = 0.0;

                // [36]: Sunrise flag
                params[36] = e.timeOfDay === 'sunrise' ? 1.0 : 0.0;

                // [37-39]: padding
                params[37] = 0.0;
                params[38] = 0.0;
                params[39] = 0.0;

                currentRendererRef.current.updateWeatherParams(params);
                currentRendererRef.current.updateCameraParams(currentPanX, currentPanY);
            }

            if (shouldRender && currentRendererRef.current) {
                if (source) {
                    currentRendererRef.current.renderStreetView('streetview', source, renderHeading, renderPitch, zoom);
                } else {
                    currentRendererRef.current.renderWeatherOnly();
                }
                sourceChangeFlagRef.current = false;
            } else if (currentRendererRef.current) {
                currentRendererRef.current.updateWeatherAnimation();
            }

            frameCountRef.current++;
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => {
            active = false;
            cancelAnimationFrame(animationFrameId.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, zoom, heading, carHeading, viewMode, shouldSkipFrame]);

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
                // Cruise pause: brief fade-to-black during panorama transitions
                opacity: isStreetViewTransitioning ? 0 : 1,
                transition: 'opacity 0.2s ease-in-out'
            }}
        />
    );
};

export default WebGPUCanvas;
