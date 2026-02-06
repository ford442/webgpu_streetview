import React, { useState, useRef, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import StreetView from './components/StreetView';
import InputHandler from './components/InputHandler';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { findBestLink } from './utils/navigation';
import MiniMap from './components/MiniMap';
import WelcomeModal from './components/WelcomeModal';
import './style.css';

// Constants for cruise mode timing
const TRANSITION_DELAY_MS = 1500; // Time to wait for panorama tiles to load after a position change
const CRUISE_INTERVAL_MS = 3000;  // Time between automatic hops in cruise mode

function App() {
    const [mode] = useState<RenderMode>('streetview');
    const [zoom, setZoom] = useState(1.0);
    const [effectiveZoom, setEffectiveZoom] = useState(1.0);
    const [webGPUAvailable, setWebGPUAvailable] = useState<boolean | null>(null); // null = checking, true = available, false = not available

    // Welcome Modal state
    const [showWelcome, setShowWelcome] = useState(true);

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

    // Route planning state
    const [routeDestination, setRouteDestination] = useState<string>('');
    const [routePath, setRoutePath] = useState<google.maps.LatLng[] | null>(null);
    const [routeWaypoints, setRouteWaypoints] = useState<google.maps.DirectionsStep[] | null>(null);
    const [currentWaypointIndex, setCurrentWaypointIndex] = useState(0);
    const [isRoutePlanning, setIsRoutePlanning] = useState(false);
    const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

    // Radio state
    const [isRadioPlaying, setIsRadioPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

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

    // --- INPUT HANDLER ACTIONS ---
    const handlePan = useCallback((deltaX: number, deltaY: number) => {
        // X is inverted (plus), Y is standard (minus) based on user feedback
        setHeading(prev => (prev + deltaX * 0.1) % 360);
        setPitch(prev => Math.max(-90, Math.min(90, prev - deltaY * 0.1)));
    }, []);

    const handleZoom = useCallback((deltaZ: number) => {
        // REVERSED: Subtraction now creates the expected behavior (Scroll Up = Zoom In, Down = Zoom Out)
        // Clamp to maximum zoom level to prevent rendering issues
        setZoom(prev => Math.max(1.0, Math.min(3.0, prev - deltaZ * 0.001)));
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
            const panoZoom = Math.floor(Math.min(zoom, 3.0));
            panorama.setZoom(panoZoom);

            // Use the actual zoom level that Google Maps accepted, not our desired zoom
            const actualZoom = panorama.getZoom();
            setEffectiveZoom(actualZoom);
        } else {
            setEffectiveZoom(Math.min(zoom, 3.0));
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

            let targetHeading = heading;

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
                setHeading(targetHeading);
            }
        };

        cruiseIntervalRef.current = setInterval(performCruiseHop, CRUISE_INTERVAL_MS);

        return () => {
            if (cruiseIntervalRef.current) {
                clearInterval(cruiseIntervalRef.current);
                cruiseIntervalRef.current = null;
            }
        };
    }, [isCruiseMode, panorama, heading, isTransitioning, routeWaypoints, currentWaypointIndex]);

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