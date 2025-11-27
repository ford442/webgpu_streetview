import React, { useState, useRef, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import StreetView from './components/StreetView';
import InputHandler from './components/InputHandler';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { findBestLink } from './utils/navigation';
import './style.css';

function App() {
    const [mode] = useState<RenderMode>('streetview');
    const [zoom, setZoom] = useState(1.0);

    // POV state
    const [heading, setHeading] = useState(34);
    const [pitch, setPitch] = useState(10);

    // Street View state
    const [streetViewCanvas, setStreetViewCanvas] = useState<HTMLCanvasElement | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [panorama, setPanorama] = useState<google.maps.StreetViewPanorama | null>(null);
    const [isCruiseMode, setIsCruiseMode] = useState(false);

    const GOOGLE_MAPS_KEY = "AIzaSyABKwxIeRZX7VcFIejGkpSplxST_E0-Xn0";
    const rendererRef = useRef<Renderer | null>(null);

    // --- INPUT HANDLER ACTIONS ---
    const handlePan = useCallback((deltaX: number, deltaY: number) => {
        setHeading(prev => (prev - deltaX * 0.1) % 360);
        setPitch(prev => Math.max(-90, Math.min(90, prev - deltaY * 0.1)));
    }, []);

    const handleZoom = useCallback((deltaZ: number) => {
        setZoom(prev => Math.max(0.5, Math.min(3.0, prev + deltaZ * 0.001)));
    }, []);

    const handleMove = useCallback((direction: 'forward' | 'backward' | 'left' | 'right') => {
        if (!panorama) return;

        const links = panorama.getLinks();
        if (!links) return;

        const bestLink = findBestLink(links, heading, direction);
        if (bestLink && bestLink.pano) {
            panorama.setPano(bestLink.pano);
        }
    }, [panorama, heading]);

    const handleRightClickMove = useCallback(() => {
        handleMove('forward');
    }, [handleMove]);

    // Effect to update the panorama POV when heading or pitch changes
    useEffect(() => {
        if (panorama) {
            panorama.setPov({ heading, pitch });
        }
    }, [heading, pitch, panorama]);

    // Effect to update the panorama zoom when our zoom state changes
    useEffect(() => {
        if (panorama) {
            // This is where the hybrid zoom logic will go
            // For now, a simple mapping:
            const panoZoom = Math.floor(zoom);
            if (panoZoom !== panorama.getZoom()) {
                panorama.setZoom(panoZoom);
            }
        }
    }, [zoom, panorama]);

    // --- UI ACTIONS ---
    const takeSnapshot = () => {
        if (rendererRef.current) {
            const canvas = rendererRef.current['canvas'] as HTMLCanvasElement;
            const link = document.createElement('a');
            const lat = panorama?.getPosition()?.lat().toFixed(4);
            const lng = panorama?.getPosition()?.lng().toFixed(4);
            link.download = `snapshot-${lat},${lng}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
    };

    return (
        <div id="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
            <InputHandler
                isEnabled={isConnected && !isCruiseMode}
                onPan={handlePan}
                onZoom={handleZoom}
                onMove={handleMove}
                onRightClickMove={handleRightClickMove}
            />

            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: isConnected ? 0 : 2 }}>
                <StreetView
                    apiKey={GOOGLE_MAPS_KEY}
                    onCanvasReady={setStreetViewCanvas}
                    onPanoramaReady={setPanorama}
                />
            </div>

            <div data-testid="webgpu-canvas-container" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: isConnected ? 2 : 0, pointerEvents: isConnected ? 'auto' : 'none', opacity: isConnected ? 1 : 0 }}>
                <WebGPUCanvas
                    rendererRef={rendererRef}
                    mode={mode}
                    source={isConnected ? streetViewCanvas : null}
                    zoom={zoom}
                    // panX/panY are now controlled by heading/pitch
                    panX={heading / 360}
                    panY={(pitch + 90) / 180}
                />
            </div>

            <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                {!isConnected ? (
                    <button onClick={() => setIsConnected(true)} disabled={!streetViewCanvas} className="control-btn">
                        {streetViewCanvas ? "START" : "Loading Maps..."}
                    </button>
                ) : (
                    <>
                        <button onClick={() => setIsConnected(false)} className="control-btn disconnect">
                            STOP
                        </button>
                        <button onClick={takeSnapshot} className="control-btn">
                            Save PNG
                        </button>
                        <button onClick={() => setIsCruiseMode(!isCruiseMode)} className={`control-btn ${isCruiseMode ? 'disconnect' : ''}`}>
                            Cruise: {isCruiseMode ? 'ON' : 'OFF'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

export default App;
