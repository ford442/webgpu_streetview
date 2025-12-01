import React, { useState, useRef, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import StreetView from './components/StreetView';
import InputHandler from './components/InputHandler';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { findBestLink } from './utils/navigation';
import './style.css';

// Constants for cruise mode timing
const TRANSITION_DELAY_MS = 1500; // Time to wait for panorama tiles to load after a position change
const CRUISE_INTERVAL_MS = 3000;  // Time between automatic hops in cruise mode

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
    
    // Cruise mode state: track if panorama is transitioning
    const [isTransitioning, setIsTransitioning] = useState(false);
    const cruiseIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

        const bestLink = findBestLink(
            links.filter((link): link is google.maps.StreetViewLink => link !== null),
            heading,
            direction
        );
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

    // Effect to detect panorama transitions via pano_changed event
    useEffect(() => {
        if (!panorama) return;

        const handlePanoChanged = () => {
            // Panorama is changing - start transitioning
            setIsTransitioning(true);
            
            // After a delay to allow the panorama to load, end the transition
            // This gives time for the new panorama tiles to load
            setTimeout(() => {
                setIsTransitioning(false);
            }, TRANSITION_DELAY_MS);
        };

        const listener = panorama.addListener('pano_changed', handlePanoChanged);

        return () => {
            google.maps.event.removeListener(listener);
        };
    }, [panorama]);

    // Effect to handle cruise mode auto-movement
    useEffect(() => {
        if (!isCruiseMode || !panorama) {
            // Clear any existing interval when cruise mode is disabled
            if (cruiseIntervalRef.current) {
                clearInterval(cruiseIntervalRef.current);
                cruiseIntervalRef.current = null;
            }
            return;
        }

        // Function to perform a cruise hop
        const performCruiseHop = () => {
            // Only hop if not currently transitioning
            if (isTransitioning) return;

            const links = panorama.getLinks();
            if (!links) return;

            const bestLink = findBestLink(
                links.filter((link): link is google.maps.StreetViewLink => link !== null),
                heading,
                'forward'
            );
            
            if (bestLink && bestLink.pano) {
                panorama.setPano(bestLink.pano);
            }
        };

        // Set up interval for cruise hops
        cruiseIntervalRef.current = setInterval(performCruiseHop, CRUISE_INTERVAL_MS);

        return () => {
            if (cruiseIntervalRef.current) {
                clearInterval(cruiseIntervalRef.current);
                cruiseIntervalRef.current = null;
            }
        };
    }, [isCruiseMode, panorama, heading, isTransitioning]);

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
                isEnabled={isConnected && !isTransitioning}
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
                    source={isConnected && !isTransitioning ? streetViewCanvas : null}
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
