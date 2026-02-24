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
import { initCarMode, toggleCarMode, updateCarMode, disposeCarMode, setMirrorStreetViewCanvas, toggleWipers, getWiperState, CarModeState, setCarSteering, setCarWipers, updateCarGauges, toggleCarHeadlights } from './car';
import { SelectivePostProcessing } from './car/SelectivePostProcessing';
import './style.css';

// New Feature Imports
import { useBookmarks } from './hooks/useBookmarks';
import { useLocationHistory } from './hooks/useLocationHistory';
import { useSnapshots } from './hooks/useSnapshots';
import BookmarkPanel from './components/BookmarkPanel';
import HistoryPanel from './components/HistoryPanel';
import SnapshotGallery from './components/SnapshotGallery';
import ColorGradingPanel from './components/ColorGradingPanel';

// Constants for cruise mode timing
const TRANSITION_DELAY_MS = 1500; // Time to wait for panorama tiles to load after a position change
const CRUISE_INTERVAL_MS = 3000;  // Time between automatic hops in cruise mode
const INITIAL_HEADING = 34;

// Head/Car Steering Separation Constants
// This implements a realistic car interior where the dashboard stays level with the
// car body, but the driver can freely look around inside the cabin.
// - headYawOffset: left/right head look relative to car heading (-110° to +110°)
// - headPitch: up/down head look (-45° to +65°)
const MAX_HEAD_YAW = 110;
const MAX_HEAD_PITCH_UP = 45;
const MAX_HEAD_PITCH_DOWN = 65;
const HEAD_LOOK_SENSITIVITY = 0.18;  // Mouse sensitivity for head look inside car
const KEYBOARD_STEER_RATE = 60; // degrees per second
const STREET_LOCK_LERP = 0.12;  // How fast car snaps to road direction (0-1)

function App() {
    const [mode] = useState<RenderMode>('streetview');
    const [zoom, setZoom] = useState(1.0);

    // Welcome Modal state
    const [showWelcome, setShowWelcome] = useState(true);

    // POV state
    const [heading, setHeading] = useState(INITIAL_HEADING);  // Free mode heading
    const [pitch, setPitch] = useState(10);                   // Free mode pitch
    const [carHeading, setCarHeading] = useState(INITIAL_HEADING);  // Car body direction (stays level with ground)
    const [headYawOffset, setHeadYawOffset] = useState(0);    // Head look left/right relative to car (-110° to +110°)
    const [headPitch, setHeadPitch] = useState(0);            // Head look up/down (-45° to +65°)

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

    // Feature: Bookmarks, History, Snapshots hooks
    const { bookmarks, addBookmark, removeBookmark } = useBookmarks();
    const { history, addToHistory, removeFromHistory, clearHistory } = useLocationHistory();
    const { snapshots, addSnapshot, removeSnapshot, updateSnapshotName, downloadSnapshot, clearAllSnapshots } = useSnapshots();

    // Panel visibility state
    const [isBookmarkPanelOpen, setIsBookmarkPanelOpen] = useState(false);
    const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
    const [isSnapshotGalleryOpen, setIsSnapshotGalleryOpen] = useState(false);

    // Color grading state
    const [vibrance, setVibrance] = useState(1.0);
    const [saturation, setSaturation] = useState(1.0);
    const [contrast, setContrast] = useState(1.0);
    const [exposure, setExposure] = useState(0.0);
    const [temperature, setTemperature] = useState(0.0);
    const [tint, setTint] = useState(0.0);
    const [isColorGradingPanelOpen, setIsColorGradingPanelOpen] = useState(false);

    // Derived view heading: combines car heading + head offset in car mode
    // This is the actual camera direction - carHeading is the body direction, headYawOffset is look deviation
    const viewHeading = React.useMemo(() => {
        return isCarMode
            ? ((carHeading + headYawOffset + 360) % 360)
            : heading;
    }, [isCarMode, carHeading, headYawOffset, heading]);

    const [isRoofOpen, setIsRoofOpen] = useState(false);
    const [rainIntensity, setRainIntensity] = useState(0);
    const [snowIntensity, setSnowIntensity] = useState(0);
    const [wind, setWind] = useState(0);
    const [wipersEnabled, setWipersEnabled] = useState(false);
    const [timeOfDay, setTimeOfDay] = useState<'day' | 'sunset' | 'night'>('day');
    const carModeRef = useRef<CarModeState | null>(null);
    const postProcessingRef = useRef<SelectivePostProcessing | null>(null);

    // Car steering and simulation
    const steeringInputRef = useRef<number>(0); // -90 to 90 degrees
    const carSpeedRef = useRef<number>(0); // 0-100 km/h (simulated)
    const carRPMRef = useRef<number>(0); // 0-8000 RPM (simulated)

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
        if (isCarMode) {
            // In car mode: mouse only moves HEAD inside the car (car stays locked to street)
            setHeadYawOffset(prev => Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, prev + deltaX * HEAD_LOOK_SENSITIVITY)));
            setHeadPitch(prev => Math.max(-MAX_HEAD_PITCH_UP, Math.min(MAX_HEAD_PITCH_DOWN, prev - deltaY * HEAD_LOOK_SENSITIVITY)));
        } else {
            // Free mode: normal look
            setHeading(prev => (prev + deltaX * 0.1) % 360);
            setPitch(prev => Math.max(-90, Math.min(90, prev - deltaY * 0.1)));
        }
    }, [isCarMode]);

    // Keyboard steering for car mode (A/D keys only)
    // When steering, the car turns and HEAD TURNS WITH IT (rigid cockpit)
    const handleSteer = useCallback((direction: 'left' | 'right', deltaTime: number) => {
        if (!isCarMode) return;
        const turnRate = KEYBOARD_STEER_RATE * deltaTime;
        if (direction === 'left') {
            setCarHeading(prev => (prev - turnRate + 360) % 360);
            steeringInputRef.current = Math.max(-90, steeringInputRef.current - turnRate * 0.5);
        } else {
            setCarHeading(prev => (prev + turnRate) % 360);
            steeringInputRef.current = Math.min(90, steeringInputRef.current + turnRate * 0.5);
        }
        // Update steering wheel animation
        setCarSteering(steeringInputRef.current);
        // Note: headYawOffset stays the same - head turns with car (relative offset)
    }, [isCarMode]);

    // Mouse-based car steering: Shift+drag horizontal controls car heading (Option 2)
    const handleMouseSteer = useCallback((deltaX: number) => {
        if (!isCarMode) return;
        setCarHeading(prev => ((prev + deltaX * 0.1) % 360 + 360) % 360);
    }, [isCarMode]);

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
            // In car mode: after moving, smoothly snap car to the actual road direction
            if (isCarMode && typeof bestLink.heading === 'number') {
                // Smooth lerp to road direction - car follows street
                setCarHeading(prev => {
                    const target = bestLink.heading as number;
                    // Handle angle wrapping for shortest path
                    let diff = target - prev;
                    while (diff > 180) diff -= 360;
                    while (diff < -180) diff += 360;
                    return prev + diff * STREET_LOCK_LERP;
                });
            }
        }
    }, [panorama, heading, isCarMode, carHeading]);

    const handleRightClickMove = useCallback(() => {
        handleMove('forward');
    }, [handleMove]);

    // Color grading handlers
    const handleVibranceChange = useCallback((value: number) => {
        setVibrance(value);
    }, []);

    const handleSaturationChange = useCallback((value: number) => {
        setSaturation(value);
    }, []);

    const handleContrastChange = useCallback((value: number) => {
        setContrast(value);
    }, []);

    const handleExposureChange = useCallback((value: number) => {
        setExposure(value);
    }, []);

    const handleTemperatureChange = useCallback((value: number) => {
        setTemperature(value);
    }, []);

    const handleTintChange = useCallback((value: number) => {
        setTint(value);
    }, []);

    // Preset handlers
    const applyPreset = useCallback((preset: string) => {
        switch (preset) {
            case 'daylight':
                setVibrance(1.0);
                setSaturation(1.0);
                setContrast(1.0);
                setExposure(0.0);
                setTemperature(0.0);
                setTint(0.0);
                break;
            case 'golden':
                setVibrance(1.2);
                setSaturation(1.1);
                setContrast(1.1);
                setExposure(0.1);
                setTemperature(0.3);
                setTint(-0.1);
                break;
            case 'sunset':
                setVibrance(1.3);
                setSaturation(1.2);
                setContrast(1.2);
                setExposure(0.2);
                setTemperature(0.5);
                setTint(-0.2);
                break;
            case 'overcast':
                setVibrance(0.8);
                setSaturation(0.9);
                setContrast(1.1);
                setExposure(-0.1);
                setTemperature(-0.2);
                setTint(0.1);
                break;
            case 'rain':
                setVibrance(0.7);
                setSaturation(0.8);
                setContrast(1.3);
                setExposure(-0.2);
                setTemperature(-0.3);
                setTint(0.2);
                break;
            case 'night':
                setVibrance(0.6);
                setSaturation(0.7);
                setContrast(1.4);
                setExposure(-0.5);
                setTemperature(-0.4);
                setTint(0.3);
                break;
            case 'snow':
                setVibrance(1.1);
                setSaturation(0.9);
                setContrast(1.2);
                setExposure(0.3);
                setTemperature(-0.1);
                setTint(0.0);
                break;
        }
    }, []);

    // Effect to update the panorama POV when view heading or pitch changes
    // In car mode: uses viewHeading (carHeading + headYawOffset) and headPitch
    // In free mode: uses heading and pitch directly
    useEffect(() => {
        if (panorama) {
            const povHeading = isCarMode ? viewHeading : heading;
            const povPitch = isCarMode ? headPitch : pitch;
            panorama.setPov({ heading: povHeading, pitch: povPitch });
        }
    }, [heading, pitch, viewHeading, headPitch, isCarMode, panorama]);

    // Effect to update the panorama zoom when our zoom state changes
    useEffect(() => {
        if (panorama) {
            const panoZoom = Math.floor(zoom);
            if (panoZoom !== panorama.getZoom()) {
                panorama.setZoom(panoZoom);
            }
        }
    }, [zoom, panorama]);


    // Update weather params in renderer when they change
    useEffect(() => {
        if (rendererRef.current) {
            // Weather params: [vibrance, sat, contrast, exposure, temp, tint, time, rain, snow, wind, speed, ...]
            const weatherParams = new Float32Array([
                vibrance, saturation, contrast, exposure, temperature, tint,  // color grading (0-5)
                0,                           // time (updated in render loop)
                rainIntensity / 50,          // rainIntensity (0-2, scaled from 0-100)
                snowIntensity / 50,          // snowIntensity (0-2, scaled from 0-100)
                wind / 100,                  // wind (-1.0 to 1.0, scaled from -100 to 100)
                1.0,                         // speed (animation speed multiplier)
                0, 0, 0, 0, 0                // padding
            ]);
            rendererRef.current.updateWeatherParams(weatherParams);
        }
    }, [vibrance, saturation, contrast, exposure, temperature, tint, rainIntensity, snowIntensity, wind]);

    // Effect to detect panorama transitions via pano_changed event
    useEffect(() => {
        if (!panorama) return;

        const handlePanoChanged = () => {
            const loc = panorama.getLocation();
            const locationDesc = loc?.description || loc?.shortDescription || "Unknown Location";
            if (loc) {
                setLocationName(locationDesc);
            }

            const position = panorama.getPosition();
            if (position) {
                const newCoords = { lat: position.lat(), lng: position.lng() };
                setCurrentCoords(newCoords);

                // Add to location history
                const currentHeading = isCarMode ? viewHeading : heading;
                const currentPitch = isCarMode ? headPitch : pitch;
                addToHistory({
                    lat: newCoords.lat,
                    lng: newCoords.lng,
                    heading: currentHeading,
                    pitch: currentPitch,
                    locationName: locationDesc,
                });
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
    }, [panorama, isCarMode, viewHeading, heading, headPitch, pitch, addToHistory]);

    // Parse URL params on mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const lat = parseFloat(params.get('lat') || '');
        const lng = parseFloat(params.get('lng') || '');
        const h = parseFloat(params.get('heading') || '');
        const p = parseFloat(params.get('pitch') || '');
        if (!isNaN(lat) && !isNaN(lng) && panorama) {
            panorama.setPosition({ lat, lng });
            if (!isNaN(h)) {
                if (isCarMode) {
                    // In car mode: set car heading, center head
                    setCarHeading(h);
                    setHeadYawOffset(0);
                } else {
                    setHeading(h);
                }
            }
            if (!isNaN(p)) {
                if (isCarMode) {
                    setHeadPitch(0); // Center head pitch in car mode
                } else {
                    setPitch(p);
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panorama]); // isCarMode is intentionally omitted - we only care about initial param parsing

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
                // In car mode: smoothly snap to road direction (street locking)
                if (isCarMode) {
                    setCarHeading(prev => {
                        // Handle angle wrapping for shortest path
                        let diff = targetHeading - prev;
                        while (diff > 180) diff -= 360;
                        while (diff < -180) diff += 360;
                        return prev + diff * STREET_LOCK_LERP;
                    });
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
                // Entering car mode: sync car to current world direction, reset head to center
                setCarHeading(heading);
                setHeadYawOffset(0);
                setHeadPitch(0);
            }
            return next;
        });
    }, [heading]);

    // Recenter head look (press 'C' while in car mode)
    const handleRecenterHead = useCallback(() => {
        if (isCarMode) {
            setHeadYawOffset(0);
            setHeadPitch(0);
        }
    }, [isCarMode]);

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

    // Update rearview mirror with Street View canvas
    useEffect(() => {
        if (isCarMode && streetViewCanvas) {
            setMirrorStreetViewCanvas(streetViewCanvas);
        }
    }, [isCarMode, streetViewCanvas]);

    // Performance: Optimized car mode rendering
    // Only runs animation when there's actual movement or changes
    useEffect(() => {
        if (!isCarMode || !carModeRef.current) return;

        let active = true;
        let lastCarHeading = carHeading;
        let lastViewHeading = viewHeading;
        let lastHeadPitch = headPitch;
        let idleFrames = 0;
        const MAX_IDLE_FRAMES = 30; // Stop RAF after 0.5s of no changes

        const animate = () => {
            if (!active) return;

            // Check if anything changed
            const headingChanged = carHeading !== lastCarHeading || viewHeading !== lastViewHeading;
            const pitchChanged = headPitch !== lastHeadPitch;
            const hasChanges = headingChanged || pitchChanged;

            if (hasChanges) {
                idleFrames = 0;
                lastCarHeading = carHeading;
                lastViewHeading = viewHeading;
                lastHeadPitch = headPitch;

                // Car interior rotates with carHeading (follows road)
                updateCarMode(carHeading, viewHeading, headPitch);
            } else {
                idleFrames++;
            }

            // Gradually center steering when no input
            if (steeringInputRef.current !== 0) {
                steeringInputRef.current *= 0.92; // Decay
                if (Math.abs(steeringInputRef.current) < 0.1) {
                    steeringInputRef.current = 0;
                }
                setCarSteering(steeringInputRef.current);
            }

            // Simulate gradual speed increase based on forward movement
            // This is basic - just simulate movement causing acceleration
            if (carSpeedRef.current > 0) {
                carSpeedRef.current = Math.max(0, carSpeedRef.current - 5); // Decay
            }

            // RPM correlates with steering input and speed
            carRPMRef.current = Math.abs(steeringInputRef.current) * 100 + carSpeedRef.current * 50;
            updateCarGauges(carSpeedRef.current, carRPMRef.current);
        };

        return () => {
            active = false;
        };
    }, [isCarMode, carHeading, viewHeading, headPitch]);

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

    const handleSnowIntensity = useCallback((value: number) => {
        setSnowIntensity(value);
    }, []);

    const handleWind = useCallback((value: number) => {
        setWind(value);
    }, []);

    const handleTimeOfDay = useCallback((value: string) => {
        if (value === 'day' || value === 'sunset' || value === 'night') {
            setTimeOfDay(value);
        }
    }, []);

    const handleToggleWipers = useCallback(() => {
        const newState = toggleWipers();
        setWipersEnabled(newState);
        setCarWipers(newState);
    }, []);

    // [ENHANCED] Snapshot handler with gallery save and JSON sidecar metadata
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
        const currentHeading = isCarMode ? viewHeading : heading;
        const currentPitch = isCarMode ? headPitch : pitch;

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
                heading: currentHeading,
                pitch: currentPitch,
                zoom
            },
            renderSettings: {
                mode,
                effectiveZoom: zoom
            }
        };

        // 3. Save to Gallery (localStorage)
        addSnapshot({
            name: filenameBase,
            dataUrl: dataUrl,
            lat: position?.lat() || 0,
            lng: position?.lng() || 0,
            heading: currentHeading,
            pitch: currentPitch,
            zoom: zoom,
            locationName: locationName || "Unknown Location",
        });

        // 4. Download Image
        const imgLink = document.createElement('a');
        imgLink.download = `${filenameBase}.png`;
        imgLink.href = dataUrl;
        document.body.appendChild(imgLink);
        imgLink.click();
        document.body.removeChild(imgLink);

        // 5. Download Metadata (Sidecar JSON)
        const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
        const metaLink = document.createElement('a');
        metaLink.download = `${filenameBase}.json`;
        metaLink.href = URL.createObjectURL(metaBlob);
        document.body.appendChild(metaLink);
        metaLink.click();
        document.body.removeChild(metaLink);

        console.log('Snapshot saved to gallery and downloaded:', filenameBase);
    }, [panorama, heading, pitch, zoom, mode, locationName, isCarMode, viewHeading, headPitch, addSnapshot]);

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

    // Teleport function with optional heading and pitch
    const teleportToCoords = (lat: number, lng: number, targetHeading?: number, targetPitch?: number) => {
        if (!panorama) return;
        panorama.setPosition({ lat, lng });

        // Set heading and pitch if provided
        if (targetHeading !== undefined) {
            if (isCarMode) {
                setCarHeading(targetHeading);
                setHeadYawOffset(0);
            } else {
                setHeading(targetHeading);
            }
        }
        if (targetPitch !== undefined) {
            if (isCarMode) {
                setHeadPitch(targetPitch);
            } else {
                setPitch(targetPitch);
            }
        }

        // Close panels after teleport
        setIsBookmarkPanelOpen(false);
        setIsHistoryPanelOpen(false);
        setIsSnapshotGalleryOpen(false);
    };

    // Bookmark helper functions
    const handleAddBookmark = (name: string) => {
        const currentHeading = isCarMode ? viewHeading : heading;
        const currentPitch = isCarMode ? headPitch : pitch;
        addBookmark({
            name,
            lat: currentCoords.lat,
            lng: currentCoords.lng,
            heading: currentHeading,
            pitch: currentPitch,
        });
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

    // Performance: Throttled URL update to prevent excessive history operations
    const urlUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pendingUrlUpdateRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!panorama) return;

        // Store the update function for later execution
        pendingUrlUpdateRef.current = () => {
            const params = new URLSearchParams({
                lat: currentCoords.lat.toFixed(6),
                lng: currentCoords.lng.toFixed(6),
                heading: heading.toFixed(1),
                pitch: pitch.toFixed(1)
            });
            window.history.replaceState({}, '', `?${params.toString()}`);
        };

        // Clear existing timeout
        if (urlUpdateTimeoutRef.current) {
            clearTimeout(urlUpdateTimeoutRef.current);
        }

        // Execute immediately on first call, then throttle subsequent calls
        if (!urlUpdateTimeoutRef.current) {
            pendingUrlUpdateRef.current();
        }

        // Set timeout for throttling (200ms)
        urlUpdateTimeoutRef.current = setTimeout(() => {
            if (pendingUrlUpdateRef.current) {
                pendingUrlUpdateRef.current();
            }
            urlUpdateTimeoutRef.current = null;
        }, 200);

        return () => {
            if (urlUpdateTimeoutRef.current) {
                clearTimeout(urlUpdateTimeoutRef.current);
            }
        };
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
                onSteer={handleSteer}
                onRecenterHead={handleRecenterHead}
                onMouseSteer={handleMouseSteer}
                isCarMode={isCarMode}
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
                    panX={(isCarMode ? viewHeading : heading) / 360}
                    panY={((isCarMode ? headPitch : pitch) + 90) / 180}
                />

                {/* Compass Overlay - shows which direction is North */}
                {isConnected && <Compass heading={isCarMode ? viewHeading : heading} />}
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
                            heading={isCarMode ? viewHeading : heading}
                            routePath={routePath}
                        />
                    )}
                </div>
            </div>

            <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                {/* Coordinates Display */}
                <div style={{ background: 'rgba(0,0,0,0.7)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    📍 {currentCoords.lat.toFixed(6)}, {currentCoords.lng.toFixed(6)} | {(isCarMode ? viewHeading : heading).toFixed(0)}° | {(isCarMode ? headPitch : pitch).toFixed(0)}°
                    {isCarMode && <span style={{ color: '#4CAF50', marginLeft: '8px' }}>🚗 {carHeading.toFixed(0)}°</span>}
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
                            const currentHeading = isCarMode ? viewHeading : heading;
                            const currentPitch = isCarMode ? headPitch : pitch;
                            const url = `${window.location.origin}${window.location.pathname}?lat=${currentCoords.lat.toFixed(6)}&lng=${currentCoords.lng.toFixed(6)}&heading=${currentHeading.toFixed(1)}&pitch=${currentPitch.toFixed(1)}`;
                            navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
                        }} className="control-btn">
                            📎 Share Link
                        </button>
                        <button
                            onClick={() => {
                                setIsBookmarkPanelOpen(!isBookmarkPanelOpen);
                                setIsHistoryPanelOpen(false);
                                setIsSnapshotGalleryOpen(false);
                            }}
                            className={`control-btn ${isBookmarkPanelOpen ? 'disconnect' : ''}`}
                        >
                            📌 Bookmarks ({bookmarks.length})
                        </button>
                        <button
                            onClick={() => {
                                setIsHistoryPanelOpen(!isHistoryPanelOpen);
                                setIsBookmarkPanelOpen(false);
                                setIsSnapshotGalleryOpen(false);
                            }}
                            className={`control-btn ${isHistoryPanelOpen ? 'disconnect' : ''}`}
                        >
                            🕐 History ({history.length})
                        </button>
                        <button
                            onClick={() => {
                                setIsSnapshotGalleryOpen(!isSnapshotGalleryOpen);
                                setIsBookmarkPanelOpen(false);
                                setIsHistoryPanelOpen(false);
                                setIsColorGradingPanelOpen(false);
                            }}
                            className={`control-btn ${isSnapshotGalleryOpen ? 'disconnect' : ''}`}
                        >
                            📸 Gallery ({snapshots.length})
                        </button>
                        <button
                            onClick={() => {
                                setIsColorGradingPanelOpen(!isColorGradingPanelOpen);
                                setIsBookmarkPanelOpen(false);
                                setIsHistoryPanelOpen(false);
                                setIsSnapshotGalleryOpen(false);
                            }}
                            className={`control-btn ${isColorGradingPanelOpen ? 'disconnect' : ''}`}
                        >
                            🎨 Color
                        </button>
                    </>
                )}
            </div>

            {/* Feature Panels */}
            <BookmarkPanel
                bookmarks={bookmarks}
                currentCoords={currentCoords}
                onTeleport={teleportToCoords}
                onAddBookmark={handleAddBookmark}
                onRemoveBookmark={removeBookmark}
                onClose={() => setIsBookmarkPanelOpen(false)}
                isOpen={isBookmarkPanelOpen}
            />

            <HistoryPanel
                history={history}
                onTeleport={teleportToCoords}
                onRemoveEntry={removeFromHistory}
                onClearHistory={clearHistory}
                onClose={() => setIsHistoryPanelOpen(false)}
                isOpen={isHistoryPanelOpen}
            />

            <SnapshotGallery
                snapshots={snapshots}
                onRemoveSnapshot={removeSnapshot}
                onUpdateName={updateSnapshotName}
                onDownload={downloadSnapshot}
                onTeleport={teleportToCoords}
                onClose={() => setIsSnapshotGalleryOpen(false)}
                onClearAll={clearAllSnapshots}
                isOpen={isSnapshotGalleryOpen}
            />

            <ColorGradingPanel
                vibrance={vibrance}
                saturation={saturation}
                contrast={contrast}
                exposure={exposure}
                temperature={temperature}
                tint={tint}
                onVibranceChange={handleVibranceChange}
                onSaturationChange={handleSaturationChange}
                onContrastChange={handleContrastChange}
                onExposureChange={handleExposureChange}
                onTemperatureChange={handleTemperatureChange}
                onTintChange={handleTintChange}
                onPreset={applyPreset}
                onClose={() => setIsColorGradingPanelOpen(false)}
                isOpen={isColorGradingPanelOpen}
            />

            {/* Car Mode Dashboard UI */}
            {isConnected && (
                <DashboardUI
                    isVisible={isCarMode}
                    isRadioPlaying={isRadioPlaying}
                    onToggleGPS={() => setIsMapOpen(!isMapOpen)}
                    onToggleRadio={toggleRadio}
                    onRainIntensity={handleRainIntensity}
                    onSnowIntensity={handleSnowIntensity}
                    onWind={handleWind}
                    onTimeOfDay={handleTimeOfDay}
                    onToggleRoof={handleToggleRoof}
                    onToggleWipers={handleToggleWipers}
                    isRoofOpen={isRoofOpen}
                    wipersEnabled={wipersEnabled}
                    rainIntensity={rainIntensity}
                    snowIntensity={snowIntensity}
                    wind={wind}
                    timeOfDay={timeOfDay}
                    audioElement={audioRef.current}
                />
            )}

            {/* Car Mode Control Hints Overlay */}
            {isConnected && isCarMode && (
                <div style={{
                    position: 'fixed',
                    bottom: 20,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(0,0,0,0.75)',
                    color: '#fff',
                    padding: '10px 18px',
                    borderRadius: 8,
                    fontSize: 13,
                    pointerEvents: 'none',
                    zIndex: 1000,
                    whiteSpace: 'nowrap',
                    border: '1px solid rgba(255,255,255,0.2)',
                    fontFamily: 'system-ui, sans-serif'
                }}>
                    🚗 <strong>Car Mode</strong>&nbsp;&nbsp;
                    <span style={{ opacity: 0.85 }}>Mouse</span> = Look &nbsp;|&nbsp;
                    <span style={{ opacity: 0.85 }}>↑↓←→</span> = Move car &nbsp;|&nbsp;
                    <span style={{ opacity: 0.85 }}>A/D</span> = Steer &nbsp;|&nbsp;
                    <span style={{ opacity: 0.85 }}>Shift+Drag</span> = Mouse steer &nbsp;|&nbsp;
                    <span style={{ opacity: 0.85 }}>C</span> = Recenter
                </div>
            )}
        </div>
    );
}

export default App;
