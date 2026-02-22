import React, { useState, useRef, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import StreetView from './components/StreetView';
import InputHandler from './components/InputHandler';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { findBestLink } from './utils/navigation';
import MiniMap from './components/MiniMap';
import WelcomeModal from './components/WelcomeModal';
import Compass from './components/Compass';
import DashboardUI from './car/DashboardUI';
import { initCarMode, toggleCarMode, updateCarMode, disposeCarMode, CarModeState } from './car';
import { SelectivePostProcessing } from './car/SelectivePostProcessing';
import './style.css';

// Constants for cruise mode timing
const TRANSITION_DELAY_MS = 1500; // Time to wait for panorama tiles to load after a position change
const CRUISE_INTERVAL_MS = 3000;  // Time between automatic hops in cruise mode
const INITIAL_HEADING = 34;

function App() {
    const [mode] = useState<RenderMode>('streetview');
    const [zoom, setZoom] = useState(1.0);

    // Welcome Modal state
    const [showWelcome, setShowWelcome] = useState(true);

    // POV state
    const [heading, setHeading] = useState(INITIAL_HEADING);
    const [pitch, setPitch] = useState(10);
    const [carHeading, setCarHeading] = useState(INITIAL_HEADING);

    // Map UI state
    const [isMapOpen, setIsMapOpen] = useState(false);
    const [locationName, setLocationName] = useState<string>('');

    // Location state
    const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number }>({ lat: 39.2575004, lng: -121.021821 });
    const [searchQuery, setSearchQuery] = useState('');

    // Street View state
    const [streetViewCanvas, setStreetViewCanvas] = useState<HTMLCanvasElement | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [panorama, setPanorama] = useState<google.maps.StreetViewPanorama | null>(null);
    const [isCruiseMode, setIsCruiseMode] = useState(false);

    // Cruise mode state: track if panorama is transitioning
    const [isTransitioning, setIsTransitioning] = useState(false);
    const cruiseIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Route planning state
    const [routeDestination, setRouteDestination] = useState<string>('');
    const [routePath, setRoutePath] = useState<google.maps.LatLng[] | null>(null);
    const [routeWaypoints, setRouteWaypoints] = useState<google.maps.DirectionsStep[] | null>(null);
    const [currentWaypointIndex, setCurrentWaypointIndex] = useState(0);
    const [isRoutePlanning, setIsRoutePlanning] = useState(false);
    const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);
    const geocoderRef = useRef<google.maps.Geocoder | null>(null);

    // Radio state
    const [isRadioPlaying, setIsRadioPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Car mode state
    const [isCarMode, setIsCarMode] = useState(false);
    const [isRoofOpen, setIsRoofOpen] = useState(false);
    const [rainIntensity, setRainIntensity] = useState(0);
    const [timeOfDay, setTimeOfDay] = useState<'day' | 'sunset' | 'night'>('day');
    const carModeRef = useRef<CarModeState | null>(null);
    const postProcessingRef = useRef<SelectivePostProcessing | null>(null);

    useEffect(() => {
        if (!audioRef.current) {
            audioRef.current = new Audio('https://stream.zeno.fm/ywcmn7hpha0uv');
            audioRef.current.crossOrigin = "anonymous";
        }

    }, []);

    // Initialize Directions Service when API is ready
    useEffect(() => {
        if (window.google && window.google.maps && !directionsServiceRef.current) {
            directionsServiceRef.current = new google.maps.DirectionsService();
        }
    }, [panorama]);

    const GOOGLE_MAPS_KEY = "AIzaSyBNfAGRfS1TNlH0EmxNfegqTsiwzYk6reM";
    const rendererRef = useRef<Renderer | null>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null); // Ref for input handling scope

    // --- INPUT HANDLER ACTIONS ---
    const handlePan = useCallback((deltaX: number, deltaY: number) => {
        // X is inverted (plus), Y is standard (minus) based on user feedback
        setHeading(prev => (prev + deltaX * 0.1) % 360);
        setPitch(prev => Math.max(-90, Math.min(90, prev - deltaY * 0.1)));
    }, []);

    const handleZoom = useCallback((deltaZ: number) => {
        // REVERSED: Subtraction now creates the expected behavior (Scroll Up = Zoom In, Down = Zoom Out)
        setZoom(prev => Math.max(1.0, Math.min(3.0, prev - deltaZ * 0.001)));
    }, []);

    const handleMove = useCallback((direction: 'forward' | 'backward' | 'left' | 'right') => {
        if (!panorama) return;

        const links = panorama.getLinks();
        if (!links) return;

        const movementHeading = isCarMode ? carHeading : heading;

        const bestLink = findBestLink(
            links.filter((link): link is google.maps.StreetViewLink => link !== null),
            movementHeading,
            direction
        );
        if (bestLink && bestLink.pano) {
            panorama.setPano(bestLink.pano);
            if (isCarMode && typeof bestLink.heading === 'number') {
                setCarHeading(bestLink.heading);
            }
        }
    }, [panorama, heading, isCarMode, carHeading]);

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

            const position = panorama.getPosition();
            if (position) {
                setCurrentCoords({ lat: position.lat(), lng: position.lng() });
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

    // Parse URL params on mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const lat = parseFloat(params.get('lat') || '');
        const lng = parseFloat(params.get('lng') || '');
        const h = parseFloat(params.get('heading') || '');
        const p = parseFloat(params.get('pitch') || '');
        if (!isNaN(lat) && !isNaN(lng) && panorama) {
            panorama.setPosition({ lat, lng });
            if (!isNaN(h)) setHeading(h);
            if (!isNaN(p)) setPitch(p);
        }
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

            let targetHeading = isCarMode ? carHeading : heading;

            // If we have a route with waypoints, navigate towards the next waypoint
            if (routeWaypoints && routeWaypoints.length > 0 && currentWaypointIndex < routeWaypoints.length) {
                const currentPos = panorama.getPosition();
                if (currentPos) {
                    const targetWaypoint = routeWaypoints[currentWaypointIndex];
                    const targetLat = targetWaypoint.end_location.lat();
                    const targetLng = targetWaypoint.end_location.lng();

                    // Calculate heading to the target waypoint
                    targetHeading = calculateHeading(
                        currentPos.lat(),
                        currentPos.lng(),
                        targetLat,
                        targetLng
                    );

                    // Check if we're close enough to the current waypoint to move to the next one
                    const distanceToWaypoint = calculateDistance(
                        currentPos.lat(),
                        currentPos.lng(),
                        targetLat,
                        targetLng
                    );

                    // If within ~50 meters, advance to next waypoint
                    if (distanceToWaypoint < 0.05) { // ~50 meters in km
                        setCurrentWaypointIndex(prev => {
                            const nextIndex = prev + 1;
                            if (nextIndex >= routeWaypoints.length) {
                                // Route completed!
                                setIsCruiseMode(false);
                            }
                            return nextIndex;
                        });
                        return;
                    }
                }
            }

            // Find the best link based on target heading
            const bestLink = findBestLink(
                links.filter((link): link is google.maps.StreetViewLink => link !== null),
                targetHeading,
                'forward'
            );

            if (bestLink && bestLink.pano) {
                panorama.setPano(bestLink.pano);
                // Update heading to face the direction we're moving
                if (isCarMode) {
                    setCarHeading(targetHeading);
                } else {
                    setHeading(targetHeading);
                }
            }
        };

        cruiseIntervalRef.current = setInterval(performCruiseHop, CRUISE_INTERVAL_MS);

        return () => {
            if (cruiseIntervalRef.current) {
                clearInterval(cruiseIntervalRef.current);
                cruiseIntervalRef.current = null;
            }
        };
    }, [isCruiseMode, panorama, heading, carHeading, isCarMode, isTransitioning, routeWaypoints, currentWaypointIndex]);

    // --- UI ACTIONS ---
    const handleStart = () => {
        setShowWelcome(false);
        setIsConnected(true);
    };

    const toggleRadio = () => {
        if (!audioRef.current) return;

        if (isRadioPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play().catch(e => console.error("Audio play failed:", e));
        }
        setIsRadioPlaying(!isRadioPlaying);
    };

    // --- CAR MODE ---
    const handleToggleCarMode = useCallback(() => {
        setIsCarMode(prev => {
            const next = !prev;
            if (next) {
                setCarHeading(heading);
            }
            return next;
        });
    }, [heading]);

    // Initialize/teardown car mode when toggled
    useEffect(() => {
        if (isCarMode && canvasContainerRef.current) {
            if (!carModeRef.current) {
                const state = initCarMode(canvasContainerRef.current);
                carModeRef.current = state;
                postProcessingRef.current = state.postProcessing;
            }
            toggleCarMode(true);
            if (rendererRef.current) {
                rendererRef.current.setCarMode(true);
            }
        } else {
            toggleCarMode(false);
            if (rendererRef.current) {
                rendererRef.current.setCarMode(false);
            }
        }
    }, [isCarMode]);

    // Update car mode rendering each frame via effect
    useEffect(() => {
        if (!isCarMode || !carModeRef.current) return;
        let active = true;
        const animate = () => {
            if (!active) return;
            updateCarMode(heading, pitch);
            requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; };
    }, [isCarMode, heading, pitch]);

    // Update post-processing effects when settings change
    useEffect(() => {
        if (!postProcessingRef.current || !rendererRef.current) return;
        postProcessingRef.current.setRainIntensity(rainIntensity);
        postProcessingRef.current.setTimeOfDay(timeOfDay);
        rendererRef.current.updateEffects(postProcessingRef.current.getUniformData());
    }, [rainIntensity, timeOfDay]);

    // Handle car mode resize
    useEffect(() => {
        if (!isCarMode || !carModeRef.current) return;
        const handleResize = () => {
            carModeRef.current?.interior.resize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [isCarMode]);

    // Cleanup car mode on unmount
    useEffect(() => {
        return () => {
            disposeCarMode();
        };
    }, []);

    const handleToggleRoof = useCallback(() => {
        setIsRoofOpen(prev => !prev);
        carModeRef.current?.interior.toggleRoof();
    }, []);

    const handleRainIntensity = useCallback((value: number) => {
        setRainIntensity(value);
    }, []);

    const handleTimeOfDay = useCallback((value: string) => {
        if (value === 'day' || value === 'sunset' || value === 'night') {
            setTimeOfDay(value);
        }
    }, []);

    // [ENHANCED] Snapshot handler with JSON sidecar metadata
    const handleSnapshot = useCallback(() => {
        if (!rendererRef.current || !panorama) return;

        // 1. Capture Image
        let dataUrl = '';
        try {
            dataUrl = rendererRef.current.getCanvasDataURL();
        } catch (e) {
            console.error("Failed to capture canvas:", e);
            alert("Could not take snapshot. See console.");
            return;
        }

        // 2. Gather Metadata
        const position = panorama.getPosition();
        const timestamp = new Date().toISOString();
        const filenameBase = `streetview_${timestamp.replace(/[:.]/g, '-')}`;

        const metadata = {
            version: "1.0",
            timestamp: timestamp,
            panoId: panorama.getPano(),
            location: {
                lat: position?.lat(),
                lng: position?.lng(),
                description: locationName || "Unknown Location"
            },
            pov: {
                heading,
                pitch,
                zoom
            },
            renderSettings: {
                mode,
                effectiveZoom: zoom
            }
        };

        // 3. Download Image
        const imgLink = document.createElement('a');
        imgLink.download = `${filenameBase}.png`;
        imgLink.href = dataUrl;
        document.body.appendChild(imgLink);
        imgLink.click();
        document.body.removeChild(imgLink);

        // 4. Download Metadata (Sidecar JSON)
        const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
        const metaLink = document.createElement('a');
        metaLink.download = `${filenameBase}.json`;
        metaLink.href = URL.createObjectURL(metaBlob);
        document.body.appendChild(metaLink);
        metaLink.click();
        document.body.removeChild(metaLink);

        console.log('Snapshot saved:', filenameBase);
    }, [panorama, heading, pitch, zoom, mode, locationName]);

    // Helper function to calculate heading between two points
    const calculateHeading = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const lat1Rad = lat1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;

        const y = Math.sin(dLng) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

        let heading = Math.atan2(y, x) * 180 / Math.PI;
        heading = (heading + 360) % 360;
        return heading;
    };

    // Helper function to calculate distance between two points (Haversine formula)
    const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Distance in km
    };

    // Teleport function
    const teleportToCoords = (lat: number, lng: number) => {
        if (!panorama) return;
        panorama.setPosition({ lat, lng });
    };

    // Search handler
    const handleSearch = () => {
        if (!searchQuery.trim() || !geocoderRef.current) return;
        geocoderRef.current.geocode({ address: searchQuery }, (results, status) => {
            if (status === 'OK' && results?.[0]?.geometry?.location) {
                const loc = results[0].geometry.location!;
                setCurrentCoords({ lat: loc.lat(), lng: loc.lng() });
                teleportToCoords(loc.lat(), loc.lng());
                setSearchQuery('');
            } else {
                alert('Location not found');
            }
        });
    };

    // Function to plot a route using Google Directions API
    const plotRoute = () => {
        if (!panorama || !routeDestination.trim() || !directionsServiceRef.current) {
            console.error('Missing required data for route planning');
            return;
        }

        setIsRoutePlanning(true);

        const currentPos = panorama.getPosition();
        if (!currentPos) {
            setIsRoutePlanning(false);
            return;
        }

        try {
            const request: google.maps.DirectionsRequest = {
                origin: new google.maps.LatLng(currentPos.lat(), currentPos.lng()),
                destination: routeDestination,
                travelMode: google.maps.TravelMode.WALKING,
            };

            directionsServiceRef.current.route(request, (result, status) => {
                setIsRoutePlanning(false);

                if (status === google.maps.DirectionsStatus.OK && result) {
                    const route = result.routes[0];
                    const path: google.maps.LatLng[] = [];
                    const steps: google.maps.DirectionsStep[] = [];

                    // Extract path and steps from the route
                    route.legs.forEach(leg => {
                        leg.steps.forEach(step => {
                            steps.push(step);
                            if (step.path) {
                                step.path.forEach(point => {
                                    path.push(point);
                                });
                            }
                        });
                    });

                    // Validate that we have valid route data
                    if (path.length === 0 || steps.length === 0) {
                        console.error('Route has no valid path data');
                        alert('Route calculated but has no valid path. Please try a different destination.');
                        return;
                    }

                    setRoutePath(path);
                    setRouteWaypoints(steps);
                    setCurrentWaypointIndex(0);

                    console.log(`Route calculated: ${steps.length} steps, ${path.length} points`);
                } else {
                    console.error('Directions request failed:', status);
                    alert(`Could not calculate route: ${status}`);
                }
            });
        } catch (error) {
            setIsRoutePlanning(false);
            console.error('Error plotting route:', error);
            alert('Error plotting route. Please try again.');
        }
    };

    // Function to clear the current route
    const clearRoute = () => {
        setRoutePath(null);
        setRouteWaypoints(null);
        setCurrentWaypointIndex(0);
        setRouteDestination('');
    };

    // Update URL on position change
    useEffect(() => {
        if (!panorama) return;
        const params = new URLSearchParams({
            lat: currentCoords.lat.toFixed(6),
            lng: currentCoords.lng.toFixed(6),
            heading: heading.toFixed(1),
            pitch: pitch.toFixed(1)
        });
        window.history.replaceState({}, '', `?${params.toString()}`);
    }, [currentCoords, heading, pitch, panorama]);

    return (
        <div id="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', padding: 0, margin: 0, backgroundColor: '#000' }}>
            {showWelcome && <WelcomeModal onStart={handleStart} />}

            {/* Input Handler - scoped to canvas container */}
            <InputHandler
                isEnabled={isConnected && !showWelcome}
                targetRef={canvasContainerRef}
                onPan={handlePan}
                onZoom={handleZoom}
                onMove={handleMove}
                onRightClickMove={handleRightClickMove}
                onToggleCarMode={handleToggleCarMode}
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
                    initialPosition={currentCoords}
                    onCanvasReady={setStreetViewCanvas}
                    onPanoramaReady={(pano) => {
                        setPanorama(pano);
                        if (directionsServiceRef.current) return; // Avoid duplicate
                        directionsServiceRef.current = new google.maps.DirectionsService();
                        geocoderRef.current = new google.maps.Geocoder(); // Init geocoder
                    }}
                />
            </div>

            {/* WebGPU Output */}
            <div ref={canvasContainerRef} data-testid="webgpu-canvas-container" style={{
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
                
                {/* Compass Overlay - shows which direction is North */}
                {isConnected && <Compass heading={heading} />}
            </div>

            {/* Slide-out Map Container (Expanded to 50%) */}
            <div
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onMouseMove={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{
                    position: 'absolute',
                    top: 0,
                    right: 0, // Pinned to right
                    transform: isMapOpen ? 'translateX(0)' : 'translateX(100%)', // Slide effect using transform
                    width: '50vw', // 50% of Viewport Width
                    minWidth: '400px', // Minimum width for mobile/small screens
                    maxWidth: '100vw', // Ensure it doesn't overflow horizontally on tiny screens
                    height: '100%',
                    backgroundColor: '#222',
                    zIndex: 20, // Above controls
                    transition: 'transform 0.3s ease-in-out', // Animate the transform
                    boxShadow: '-2px 0 10px rgba(0,0,0,0.5)',
                    display: 'flex',
                    flexDirection: 'column'
                }}
            >
                <div style={{ padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #444', backgroundColor: '#1f1f1f' }}>
                    <h3 style={{ margin: 0, color: '#fff', fontSize: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {locationName || "Map View"}
                    </h3>
                    <button 
                        onClick={() => setIsMapOpen(false)} 
                        style={{ 
                            background: 'rgba(255,255,255,0.1)', 
                            border: '1px solid #555', 
                            color: '#fff', 
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 'bold'
                        }}
                    >
                        Close Map ✕
                    </button>
                </div>

                {/* Search Section */}
                <div style={{ padding: '15px', borderBottom: '1px solid #444', backgroundColor: '#2a2a2a' }}>
                    <label style={{ display: 'block', color: '#ccc', fontSize: '13px', marginBottom: '8px', fontWeight: 'bold' }}>Search/Teleport</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input
                            type="text"
                            placeholder="Search address or coords..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                            style={{ flex: 1, padding: '10px', border: '1px solid #555', borderRadius: '4px', backgroundColor: '#333', color: '#fff', fontSize: '14px' }}
                        />
                        <button onClick={handleSearch} style={{ padding: '10px 16px', border: 'none', borderRadius: '4px', backgroundColor: '#2196F3', color: '#fff', cursor: 'pointer', fontSize: '14px' }}>
                            Go
                        </button>
                    </div>
                </div>

                {/* Route Planning Section */}
                <div style={{ padding: '15px', borderBottom: '1px solid #444', backgroundColor: '#2a2a2a' }}>
                    <label style={{ display: 'block', color: '#ccc', fontSize: '13px', marginBottom: '8px', fontWeight: 'bold' }}>Plan Route (Cruise Mode)</label>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <input
                            type="text"
                            placeholder="Enter destination (e.g., 'Eiffel Tower')..."
                            value={routeDestination}
                            onChange={(e) => setRouteDestination(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && plotRoute()}
                            style={{
                                flex: 1,
                                padding: '10px',
                                border: '1px solid #555',
                                borderRadius: '4px',
                                backgroundColor: '#333',
                                color: '#fff',
                                fontSize: '14px'
                            }}
                        />
                        <button
                            onClick={plotRoute}
                            disabled={!routeDestination.trim() || isRoutePlanning}
                            style={{
                                padding: '10px 20px',
                                border: 'none',
                                borderRadius: '4px',
                                backgroundColor: isRoutePlanning ? '#555' : '#4CAF50',
                                color: '#fff',
                                cursor: isRoutePlanning ? 'wait' : 'pointer',
                                fontSize: '14px',
                                fontWeight: 'bold'
                            }}
                        >
                            {isRoutePlanning ? '...' : 'Go'}
                        </button>
                    </div>
                    {routeWaypoints && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#aaa', backgroundColor: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '4px' }}>
                            <div style={{ flex: 1 }}>
                                <strong>Active Route:</strong> {routeWaypoints.length} steps • Waypoint {currentWaypointIndex + 1}/{routeWaypoints.length}
                            </div>
                            <button
                                onClick={clearRoute}
                                style={{
                                    padding: '4px 10px',
                                    border: 'none',
                                    borderRadius: '3px',
                                    backgroundColor: '#d9534f',
                                    color: '#fff',
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                            >
                                Clear Route
                            </button>
                        </div>
                    )}
                </div>

                <div style={{ flex: 1, position: 'relative' }}>
                    {isConnected && panorama && (
                        <MiniMap
                            apiKey={GOOGLE_MAPS_KEY}
                            panorama={panorama}
                            heading={heading}
                            routePath={routePath}
                        />
                    )}
                </div>
            </div>

            <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                {/* Coordinates Display */}
                <div style={{ background: 'rgba(0,0,0,0.7)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    📍 {currentCoords.lat.toFixed(6)}, {currentCoords.lng.toFixed(6)} | {heading.toFixed(0)}° | {pitch.toFixed(0)}°
                </div>

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
                        <button onClick={handleToggleCarMode} className={`control-btn ${isCarMode ? 'disconnect' : ''}`} title="Toggle car view (C)">
                            🚗 {isCarMode ? 'In-Car' : 'Standard'}
                        </button>
                        <button onClick={handleSnapshot} className="control-btn">
                            📸 Take Snapshot
                        </button>
                        <button onClick={() => setIsCruiseMode(!isCruiseMode)} className={`control-btn ${isCruiseMode ? 'disconnect' : ''}`}>
                            Cruise: {isCruiseMode ? 'ON' : 'OFF'} {routeWaypoints && '🗺️'}
                        </button>
                        <button onClick={() => {
                            const url = `${window.location.origin}${window.location.pathname}?lat=${currentCoords.lat.toFixed(6)}&lng=${currentCoords.lng.toFixed(6)}&heading=${heading.toFixed(1)}&pitch=${pitch.toFixed(1)}`;
                            navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
                        }} className="control-btn">
                            📎 Share Link
                        </button>
                    </>
                )}
            </div>

            {/* Car Mode Dashboard UI */}
            {isConnected && (
                <DashboardUI
                    isVisible={isCarMode}
                    isRadioPlaying={isRadioPlaying}
                    onToggleGPS={() => setIsMapOpen(!isMapOpen)}
                    onToggleRadio={toggleRadio}
                    onRainIntensity={handleRainIntensity}
                    onTimeOfDay={handleTimeOfDay}
                    onToggleRoof={handleToggleRoof}
                    isRoofOpen={isRoofOpen}
                    rainIntensity={rainIntensity}
                    timeOfDay={timeOfDay}
                    audioElement={audioRef.current}
                />
            )}
        </div>
    );
}

export default App;
