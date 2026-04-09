import React, { useRef, useEffect, useState } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';
import { usePerformanceMonitor } from '../hooks/usePerformanceMonitor';
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
                    // In car mode: panX/panY are already UV offsets (0.5 = center, no shift)
                    // In free mode: panX/panY are normalized angles (0.5 = center)
                    // Renderer.renderStreetViewTransition expects heading (0-360) and pitch (-90 to +90)
                    // Shader computes: shiftX = panX - 0.5, shiftY = panY - 0.5
                    const heading = isCarMode 
                        ? ((panX || 0.5) * 360)  // Convert UV offset back to pseudo-heading
                        : ((panX || 0.5) * 360); // Free mode: panX is heading/360
                    const pitch = isCarMode
                        ? ((panY || 0.5) * 180 - 90)  // Convert UV offset back to pseudo-pitch
                        : ((panY || 0.5) * 180 - 90); // Free mode: panY is (pitch+90)/180
                    
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
                    // In car mode: panX/panY are UV offsets (0.5 = center, no shift)
                    // The shader interprets panX/panY as: shift = panX - 0.5
                    // So we need to pass values that result in correct shifts after the -0.5
                    const heading = isCarMode 
                        ? ((panX || 0.5) * 360)  // panX=0.5 -> 180, shader: 180/360 - 0.5 = 0 (no shift)
                        : ((panX || 0.5) * 360); // Free mode: panX is heading/360
                    const pitch = isCarMode
                        ? ((panY || 0.5) * 180 - 90)  // panY=0.5 -> 0, shader: (0+90)/180 - 0.5 = 0 (no shift)
                        : ((panY || 0.5) * 180 - 90); // Free mode: panY is (pitch+90)/180
                    currentRendererRef.current.renderStreetView(mode, source, heading, pitch, zoom);
                }
                sourceChangeFlagRef.current = false;
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
