import React, { useRef, useEffect, useState } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

interface WebGPUCanvasProps {
    mode: RenderMode;
    source?: CanvasImageSource | null;
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
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, source, zoom, panX, panY, farthestPoint, mousePosition, setMousePosition, isMouseDown, setIsMouseDown, rendererRef, onWebGPUStatus }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const internalRendererRef = useRef<Renderer | null>(null);
    const animationFrameId = useRef<number>(0);

    // State to track window size for full-screen rendering
    const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

    // Performance: Frame skipping state
    const frameCountRef = useRef<number>(0);
    const lastSourceRef = useRef<CanvasImageSource | null>(null);
    const sourceChangeFlagRef = useRef<boolean>(true);
    const FRAME_SKIP = 3; // Render every 3rd frame (20fps) when source unchanged, 60fps when changed

    // Performance: Debounced resize
    const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const currentRendererRef = rendererRef || internalRendererRef;

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

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);

        (async () => {
            const success = await renderer.init();
            if (success) {
                if (rendererRef) {
                    (rendererRef as React.MutableRefObject<Renderer | null>).current = renderer;
                }
                onWebGPUStatus?.(true);
            } else {
                // Handle WebGPU failure (e.g., show an error or fallback)
                console.warn("WebGPU initialization failed. Please check your browser compatibility.");
                onWebGPUStatus?.(false);
            }
        })();

        return () => {
            cancelAnimationFrame(animationFrameId.current);
        };
    }, [rendererRef, onWebGPUStatus]);

    useEffect(() => {
        // Performance: Track source changes
        if (source !== lastSourceRef.current) {
            sourceChangeFlagRef.current = true;
            lastSourceRef.current = source;
        }
    }, [source]);

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            
            // Performance: Frame skipping logic
            // Always render if source changed, otherwise render every Nth frame
            const shouldRender = sourceChangeFlagRef.current || (frameCountRef.current % FRAME_SKIP === 0);
            
            if (shouldRender && currentRendererRef.current && source) {
                const heading = (panX || 0.5) * 360;
                const pitch = (panY || 0.5) * 180 - 90;
                currentRendererRef.current.renderStreetView(mode, source, heading, pitch, zoom);
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
    }, [mode, source, zoom, panX, panY]);

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
