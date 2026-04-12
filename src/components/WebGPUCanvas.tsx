import React, { useRef, useEffect, useState } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';
import { usePerformanceMonitor, useEnvironmentSettings } from '../hooks';
import { getMemoryProfiler } from '../utils/memoryProfiler';

interface WebGPUCanvasProps {
    mode: RenderMode;
    source?: CanvasImageSource | null;
    prevSource?: CanvasImageSource | null;
    zoom?: number;
    panX?: number;
    panY?: number;
    farthestPoint?: { x: number, y: number };
    mousePosition?: { x: number, y: number };
    setMousePosition?: (pos: { x: number, y: number }) => void;
    isMouseDown?: boolean;
    setIsMouseDown?: (down: boolean) => void;
    rendererRef?: React.RefObject<Renderer | null>;
    onWebGPUStatus?: (available: boolean) => void;
    onFPSUpdate?: (fps: number) => void;
    // Transition props
    transitionState?: 'idle' | 'zooming_out' | 'crossfading' | 'zooming_in';
    transitionProgress?: number;
    // Car mode: when true, panX/panY are UV offsets (0.5 = center), not angles
    isCarMode?: boolean;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ 
    mode, 
    source, 
    prevSource,
    zoom = 1.0, 
    panX, 
    panY, 
    mousePosition, 
    setMousePosition, 
    isMouseDown, 
    setIsMouseDown, 
    rendererRef, 
    onWebGPUStatus, 
    onFPSUpdate,
    transitionState = 'idle',
    transitionProgress = 0,
    isCarMode = false
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const internalRendererRef = useRef<Renderer | null>(null);
    const animationFrameId = useRef<number>(0);
    
    // Get environment settings from React context
    const {
        nightIntensity, rainIntensity, snowIntensity, wind,
        vibrance, saturation, contrast, exposure, temperature, tint,
        headlightsOn, highBeam, domeLightOn,
        sunAzimuth, sunAltitude, moonAzimuth, moonAltitude, moonIntensity,
        shaderEffectsEnabled
    } = useEnvironmentSettings();

    // State to track window size for full-screen rendering
    const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

    // Performance: Frame skipping state
    const frameCountRef = useRef<number>(0);
    const lastSourceRef = useRef<CanvasImageSource | null | undefined>(undefined);
    const sourceChangeFlagRef = useRef<boolean>(true);
    const FRAME_SKIP = 2; // Render every 2nd frame (30fps base) when source unchanged, 60fps when changed

    // Performance: Debounced resize
    const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const currentRendererRef = rendererRef || internalRendererRef;

    // Performance monitoring
    const { stats: perfStats, startMonitoring, stopMonitoring, shouldSkipFrame } = usePerformanceMonitor({
        targetFPS: 60,
        sampleSize: 60,
        warningThreshold: 45,
        criticalThreshold: 30,
        enableAdaptiveQuality: true
    });

    // Track FPS changes and notify parent
    useEffect(() => {
        onFPSUpdate?.(perfStats.fps.current);
    }, [perfStats.fps.current, onFPSUpdate]);

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
    
    // Sync environment settings to renderer
    useEffect(() => {
        if (!currentRendererRef.current) return;
        
        // Build weather params array (36 floats)
        const params = new Float32Array(36);
        
        // [0-5]: Color grading (vibrance, saturation, contrast, exposure, temperature, tint)
        // These are stored as adjustments (-1 to 1 range in UI), convert to shader range
        params[0] = vibrance - 1.0;        // vibrance offset
        params[1] = saturation - 1.0;      // saturation offset  
        params[2] = contrast - 1.0;        // contrast offset
        params[3] = exposure;              // exposure (already in correct range)
        params[4] = temperature;           // temperature (-1 to 1)
        params[5] = tint;                  // tint (-1 to 1)
        
        // [6-10]: Animation time, rain, snow, wind, speed
        params[6] = Date.now() / 1000;     // time (will be updated each frame)
        params[7] = rainIntensity;         // rain intensity
        params[8] = snowIntensity;         // snow intensity
        params[9] = wind;                  // wind
        params[10] = 1.0;                  // speed multiplier
        
        // [11-15]: Night mode and headlights
        params[11] = nightIntensity;       // night intensity (0-1)
        params[12] = headlightsOn ? 1.0 : 0.0;  // headlights on
        params[13] = highBeam ? 1.0 : 0.0;      // high beam on
        params[14] = 0.5;                  // headlight heading (center)
        params[15] = 0.5;                  // headlight pitch (center)
        
        // [16-17]: Dome light
        params[16] = domeLightOn ? 1.0 : 0.0;   // dome light on
        params[17] = domeLightOn ? 0.5 : 0.0;   // dome light intensity (default 0.5 when on)
        
        // [18-21]: Astronomy (sun/moon position)
        params[18] = sunAzimuth;           // sun azimuth
        params[19] = sunAltitude;          // sun altitude
        params[20] = moonAzimuth;          // moon azimuth
        params[21] = moonAltitude;         // moon altitude
        
        // [22-31]: Atmospheric effects (default to 0 for now)
        params[22] = 0.0;                  // fog intensity
        params[23] = 0.0;                  // fog density
        params[24] = 0.0;                  // fog height
        params[25] = 0.0;                  // fog color index
        params[26] = 0.0;                  // light shafts intensity
        params[27] = 0.0;                  // heat shimmer intensity
        params[28] = 0.0;                  // lens flare intensity
        params[29] = 0.0;                  // chromatic aberration
        params[30] = 0.0;                  // dust intensity
        params[31] = 0.0;                  // humidity haze
        
        // [32]: Shader effects enabled flag
        params[32] = shaderEffectsEnabled ? 1.0 : 0.0;
        
        // [33-35]: Camera params and padding (set by render loop, but initialize here)
        params[33] = 0.0;                  // camera heading
        params[34] = 0.0;                  // camera pitch
        params[35] = 0.0;                  // padding
        
        currentRendererRef.current.updateWeatherParams(params);
    }, [
        nightIntensity, rainIntensity, snowIntensity, wind,
        vibrance, saturation, contrast, exposure, temperature, tint,
        headlightsOn, highBeam, domeLightOn,
        sunAzimuth, sunAltitude, moonAzimuth, moonAltitude, moonIntensity,
        shaderEffectsEnabled
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
                if (rendererRef) {
                    (rendererRef as React.MutableRefObject<Renderer | null>).current = renderer;
                }
                onWebGPUStatusRef.current?.(true);
                startMonitoringRef.current();
            } else {
                console.warn("WebGPU initialization failed. Please check your browser compatibility.");
                onWebGPUStatusRef.current?.(false);
            }
        })();

        return () => {
            isActive = false;
            if (rendererRef) {
                (rendererRef as React.MutableRefObject<Renderer | null>).current = null;
            }
            stopMonitoringRef.current();
            renderer.destroy();
        };
    }, [rendererRef, reinitCounter]);

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
            
            // During transition, always render for smooth animation
            const isTransitioning = transitionState !== 'idle';
            const shouldRender = !skipFrame && (isTransitioning || sourceChangeFlagRef.current || (frameCountRef.current % FRAME_SKIP === 0));

            if (shouldRender && currentRendererRef.current) {
                // Handle transition rendering
                if (transitionState !== 'idle' && prevSource && source) {
                    // Renderer.renderStreetViewTransition expects heading (0-360) and pitch (-90 to +90)
                    // These are passed to the shader as normalized values for weather effects only
                    const heading = ((panX || 0.5) * 360);
                    const pitch = ((panY || 0.5) * 180 - 90);
                    
                    // Render with transition blend
                    currentRendererRef.current.renderStreetViewTransition(
                        mode,
                        prevSource,
                        source,
                        heading,
                        pitch,
                        zoom,
                        transitionState,
                        transitionProgress
                    );
                } else if (source) {
                    // Normal rendering
                    // panX/panY are normalized camera directions (0.5 = center)
                    // Used by shader for world-space weather effects only (not UV shifting)
                    const heading = ((panX || 0.5) * 360);
                    const pitch = ((panY || 0.5) * 180 - 90);
                    currentRendererRef.current.renderStreetView(mode, source, heading, pitch, zoom);
                } else {
                    // No source available (loading next location) - keep weather animating
                    // This ensures rain/snow/wipers continue moving during transitions
                    currentRendererRef.current.renderWeatherOnly();
                }
                sourceChangeFlagRef.current = false;
            } else if (currentRendererRef.current) {
                // Even when skipping frames, update weather animation time
                // to keep rain/snow/wipers in sync
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
    }, [mode, source, prevSource, zoom, panX, panY, shouldSkipFrame, transitionState, transitionProgress]);

    return (
        <canvas
            ref={canvasRef}
            width={size.width}
            height={size.height}
            style={{
                display: 'block',
                width: '100%',
                height: '100%',
                // Override styles from style.css that might add borders/margins
                border: 'none',
                marginTop: 0,
                borderRadius: 0
            }}
        />
    );
};

export default WebGPUCanvas;
