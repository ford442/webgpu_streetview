import React, { useState, useRef, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import StreetView from './components/StreetView';
import InputHandler from './components/InputHandler';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { findBestLink } from './utils/navigation';
import MiniMap from './components/MiniMap'; // Import MiniMap
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

    // Map UI state
    const [isMapOpen, setIsMapOpen] = useState(false);
    const [locationName, setLocationName] = useState<string>('');

    // Street View state
    const [streetViewCanvas, setStreetViewCanvas] = useState<HTMLCanvasElement | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [panorama, setPanorama] = useState<google.maps.StreetViewPanorama | null>(null);
    const [isCruiseMode, setIsCruiseMode] = useState(false);

    // Cruise mode state: track if panorama is transitioning
    const [isTransitioning, setIsTransitioning] = useState(false);
    const cruiseIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Radio state
    const [isRadioPlaying, setIsRadioPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!audioRef.current) {
            audioRef.current = new Audio('https://stream.zeno.fm/ywcmn7hpha0uv');
            audioRef.current.crossOrigin = "anonymous";
        }
    }, []);

    const GOOGLE_MAPS_KEY = "AIzaSyABKwxIeRZX7VcFIejGkpSplxST_E0-Xn0";
    const rendererRef = useRef<Renderer | null>(null);

    // --- INPUT HANDLER ACTIONS ---
    const handlePan = useCallback((deltaX: number, deltaY: number) => {
        // X is inverted (plus), Y is standard (minus) based on user feedback
        setHeading(prev => (prev + deltaX * 0.1) % 360);
        setPitch(prev => Math.max(-90, Math.min(90, prev - deltaY * 0.1)));
    }, []);

    const handleZoom = useCallback((deltaZ: number) => {
        // REVERSED: Subtraction now creates the expected behavior (Scroll Up = Zoom In, Down = Zoom Out)
        setZoom(prev => Math.max(0.5, Math.min(3.0, prev - deltaZ * 0.001)));
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
            const loc = panorama.getLocation();
            if (loc) {
                setLocationName(loc.description || loc.shortDescription || "Unknown Location");
            }

            setIsTransitioning(true);
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
            if (cruiseIntervalRef.current) {
                clearInterval(cruiseIntervalRef.current);
                cruiseIntervalRef.current = null;
            }
            return;
        }

        const performCruiseHop = () => {
            // Only hop if not currently transitioning
            if (isTransitioning) return;

            const links = panorama.getLinks();
            if (!links) return;

            // Always use current heading, allowing user to steer
            const bestLink = findBestLink(
                links.filter((link): link is google.maps.StreetViewLink => link !== null),
                heading,
                'forward'
            );

            if (bestLink && bestLink.pano) {
                panorama.setPano(bestLink.pano);
            }
        };

        cruiseIntervalRef.current = setInterval(performCruiseHop, CRUISE_INTERVAL_MS);

        return () => {
            if (cruiseIntervalRef.current) {
                clearInterval(cruiseIntervalRef.current);
                cruiseIntervalRef.current = null;
            }
        };
    }, [isCruiseMode, panorama, heading, isTransitioning]);

    // --- UI ACTIONS ---
    const toggleRadio = () => {
        if (!audioRef.current) return;

        if (isRadioPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play().catch(e => console.error("Audio play failed:", e));
        }
        setIsRadioPlaying(!isRadioPlaying);
    };

    const takeSnapshot = () => {
        if (rendererRef.current && panorama) {
            const canvas = rendererRef.current['canvas'] as HTMLCanvasElement;
            
            // Gather snapshot metadata
            const position = panorama.getPosition();
            const lat = position?.lat().toFixed(6) || '0';
            const lng = position?.lng().toFixed(6) || '0';
            const pov = panorama.getPov();
            const currentHeading = pov?.heading?.toFixed(1) || heading.toFixed(1);
            const currentPitch = pov?.pitch?.toFixed(1) || pitch.toFixed(1);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            
            // Create descriptive filename with timestamp and coordinates
            const filename = `streetview_${timestamp}_${lat}_${lng}.png`;
            
            // Download the image
            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/png');
            link.click();
            
            // Create and download a metadata text file
            const metadata = `WebGPU StreetView Snapshot
=========================
Captured: ${new Date().toLocaleString()}
Timestamp: ${new Date().toISOString()}

Location Information:
--------------------
Location Name: ${locationName || 'Unknown Location'}
Latitude: ${lat}°
Longitude: ${lng}°
Google Maps Link: https://www.google.com/maps/@${lat},${lng},3a,75y,${currentHeading}h,${currentPitch}t/data=!3m4!1e1!3m2!1s${panorama.getPano()}!2e0

View Parameters:
---------------
Heading: ${currentHeading}° (${getCardinalDirection(parseFloat(currentHeading))})
Pitch: ${currentPitch}° (${getPitchDescription(parseFloat(currentPitch))})
Zoom: ${zoom.toFixed(2)}x

Application State:
-----------------
Render Mode: ${mode}
Cruise Mode: ${isCruiseMode ? 'ON' : 'OFF'}
Panorama ID: ${panorama.getPano() || 'N/A'}

Image File: ${filename}
`;
            
            const metadataBlob = new Blob([metadata], { type: 'text/plain' });
            const metadataLink = document.createElement('a');
            metadataLink.download = filename.replace('.png', '.txt');
            metadataLink.href = URL.createObjectURL(metadataBlob);
            metadataLink.click();
            URL.revokeObjectURL(metadataLink.href);
            
            console.log('Snapshot saved:', filename);
        }
    };
    
    // Helper function to get cardinal direction from heading
    const getCardinalDirection = (heading: number): string => {
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(((heading % 360) / 22.5));
        return directions[index % 16];
    };
    
    // Helper function to describe pitch angle
    const getPitchDescription = (pitch: number): string => {
        if (pitch > 60) return 'Looking up steeply';
        if (pitch > 30) return 'Looking up';
        if (pitch > 10) return 'Looking slightly up';
        if (pitch > -10) return 'Looking straight ahead';
        if (pitch > -30) return 'Looking slightly down';
        if (pitch > -60) return 'Looking down';
        return 'Looking down steeply';
    };

    return (
        <div id="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', padding: 0, margin: 0, backgroundColor: '#000' }}>
            {/* Input Handler enabled even during transitions to allow steering */}
            <InputHandler
                isEnabled={isConnected}
                onPan={handlePan}
                onZoom={handleZoom}
                onMove={handleMove}
                onRightClickMove={handleRightClickMove}
            />

            {/* Original StreetView: Hidden via opacity when connected, but kept in DOM for scraping */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: isConnected ? 0 : 2,
                opacity: isConnected ? 0 : 1,
                transition: 'opacity 0.5s ease-in-out'
            }}>
                <StreetView
                    apiKey={GOOGLE_MAPS_KEY}
                    onCanvasReady={setStreetViewCanvas}
                    onPanoramaReady={setPanorama}
                />
            </div>

            {/* WebGPU Output */}
            <div data-testid="webgpu-canvas-container" style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: isConnected ? 2 : 0,
                pointerEvents: isConnected ? 'auto' : 'none',
                opacity: isConnected ? 1 : 0
            }}>
                <WebGPUCanvas
                    rendererRef={rendererRef}
                    mode={mode}
                    source={isConnected && !isTransitioning ? streetViewCanvas : null}
                    zoom={zoom}
                    panX={heading / 360}
                    panY={(pitch + 90) / 180}
                />
            </div>

            {/* Slide-out Map Container */}
            <div style={{
                position: 'absolute',
                top: 0,
                right: isMapOpen ? 0 : '-400px', // Slide in from right
                width: '400px',
                height: '100%',
                backgroundColor: '#222',
                zIndex: 20, // Above controls
                transition: 'right 0.3s ease-in-out',
                boxShadow: '-2px 0 10px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <div style={{ padding: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #444' }}>
                    <h3 style={{ margin: 0, color: '#fff', fontSize: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>
                        {locationName || "Map View"}
                    </h3>
                    <button onClick={() => setIsMapOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                    {isConnected && panorama && (
                        <MiniMap
                            apiKey={GOOGLE_MAPS_KEY}
                            panorama={panorama}
                            heading={heading}
                        />
                    )}
                </div>
            </div>

            <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                {/* Map Toggle Button */}
                {isConnected && (
                    <button onClick={() => setIsMapOpen(!isMapOpen)} className="control-btn" style={{ backgroundColor: isMapOpen ? '#444' : undefined }}>
                        Map {isMapOpen ? '>>' : '<<'}
                    </button>
                )}
                <button onClick={toggleRadio} className={`control-btn ${isRadioPlaying ? 'disconnect' : ''}`} style={{ backgroundColor: isRadioPlaying ? '#ff4757' : undefined }}>
                    Radio: {isRadioPlaying ? 'ON' : 'OFF'}
                </button>
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
