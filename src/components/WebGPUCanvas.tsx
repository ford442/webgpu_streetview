import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

interface WebGPUCanvasProps {
    mode: RenderMode;
    source?: CanvasImageSource | null;
    zoom?: number;
    panX?: number;
    panY?: number;
    farthestPoint?: {x: number, y: number};
    mousePosition?: {x: number, y: number};
    setMousePosition?: (pos: {x: number, y: number}) => void;
    isMouseDown?: boolean;
    setIsMouseDown?: (down: boolean) => void;
    rendererRef?: React.RefObject<Renderer | null>;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, source, zoom, panX, panY, farthestPoint, mousePosition, setMousePosition, isMouseDown, setIsMouseDown, rendererRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const internalRendererRef = useRef<Renderer | null>(null);
    const animationFrameId = useRef<number>(0);

    const currentRendererRef = rendererRef || internalRendererRef;

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
            }
        })();
        
        return () => {
            cancelAnimationFrame(animationFrameId.current);
        };
    }, [rendererRef]);
    
    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (currentRendererRef.current && source) {
                const heading = (panX || 0.5) * 360;
                const pitch = (panY || 0.5) * 180 - 90;
                currentRendererRef.current.renderStreetView(mode, source, heading, pitch, zoom);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { 
            active = false; 
            cancelAnimationFrame(animationFrameId.current); 
        };
    }, [mode, source, zoom, panX, panY]);

    return (
        <canvas 
            ref={canvasRef} 
            width="1280" 
            height="1280"
            style={{ 
                maxWidth: '100%', 
                height: 'auto',
                border: '2px solid #333'
            }}
        />
    );
};

export default WebGPUCanvas;
