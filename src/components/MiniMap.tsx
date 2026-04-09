import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// Import crypto companies config
import { CRYPTO_COMPANIES, CryptoCompany } from '../config/cryptoCompanies';

interface MiniMapProps {
    apiKey: string;
    panorama: google.maps.StreetViewPanorama;
    heading: number;
    routePath?: google.maps.LatLng[] | null;
    viewMode?: 'map' | 'globe';
    showCryptoMarkers?: boolean;
}

const MiniMap: React.FC<MiniMapProps> = ({
    apiKey,
    panorama,
    heading,
    routePath,
    viewMode = 'map',
    showCryptoMarkers = false
}) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const cesiumRef = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<google.maps.Map | null>(null);
    const [cesiumViewer, setCesiumViewer] = useState<Cesium.Viewer | null>(null);
    const [marker, setMarker] = useState<google.maps.marker.AdvancedMarkerElement | null>(null);
    const [breadcrumbs, setBreadcrumbs] = useState<google.maps.LatLng[]>([]);
    const breadcrumbMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
    const routeLineRef = useRef<google.maps.Polyline | null>(null);
    const cryptoMarkersRef = useRef<(google.maps.marker.AdvancedMarkerElement | Cesium.Entity)[]>([]);

    // Helper to create custom marker content
    const createMarkerContent = (rotation: number): HTMLElement => {
        const el = document.createElement('div');
        el.style.cssText = `
            width: 24px; height: 24px; cursor: grab;
            background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%);
            clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
            transform: rotate(${rotation}deg);
            border: 3px solid #00CCFF;
            box-shadow: 0 0 12px #00CCFF;
        `;
        el.title = "Drag to move (You are here) 🖱️";
        return el;
    };

    // Helper to add a breadcrumb at the current panorama position
    const addBreadcrumb = useCallback(() => {
        const position = panorama.getPosition();
        if (position) {
            setBreadcrumbs(prev => [...prev, position]);
        }
    }, [panorama]);

    // Helper to move to a location (teleport)
    const teleportTo = useCallback((latLng: google.maps.LatLng | null) => {
        if (!latLng || !map) return;

        const sv = new google.maps.StreetViewService();
        sv.getPanorama({ location: latLng, radius: 50 }, (data, status) => {
            if (status === google.maps.StreetViewStatus.OK && data && data.location && data.location.pano) {
                // Save current location as breadcrumb before moving
                addBreadcrumb();

                // Move
                panorama.setPano(data.location.pano);
            } else {
                console.warn("No Street View found near this location.");
            }
        });
    }, [map, panorama, addBreadcrumb]);


    // Initialize Cesium Globe
    useEffect(() => {
        const initCesium = async () => {
            if (viewMode !== 'globe' || !cesiumRef.current || cesiumViewer) return;

            // Set Cesium Ion access token (you'll need to get this from cesium.com)
            Cesium.Ion.defaultAccessToken = process.env.REACT_APP_CESIUM_ION_TOKEN || '';

            const viewer = new Cesium.Viewer(cesiumRef.current, {
                terrainProvider: await Cesium.createWorldTerrainAsync(),
                baseLayerPicker: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                navigationHelpButton: false,
                animation: false,
                timeline: false,
                fullscreenButton: false,
                vrButton: false,
                infoBox: false,
                selectionIndicator: false,
            });

            // Configure the camera for top-down view
            viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(0, 0, 20000000), // High altitude for globe view
            });

            setCesiumViewer(viewer);
        };

        initCesium();

        return () => {
            if (cesiumViewer && !cesiumViewer.isDestroyed()) {
                cesiumViewer.destroy();
            }
            setCesiumViewer(null);
        };
    }, [viewMode, cesiumViewer]);

    // Sync Cesium camera with panorama position
    useEffect(() => {
        if (viewMode !== 'globe' || !cesiumViewer || !panorama) return;

        const updateCesiumView = () => {
            const position = panorama.getPosition();
            if (position) {
                // Fly to current location
                cesiumViewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(
                        position.lng(),
                        position.lat(),
                        100000 // Altitude in meters
                    ),
                    duration: 2.0
                });
            }
        };

        const listener = panorama.addListener('position_changed', updateCesiumView);
        updateCesiumView(); // Initial sync

        return () => {
            google.maps.event.removeListener(listener);
        };
    }, [viewMode, cesiumViewer, panorama]);

    // Sync Map with Panorama Position (and Handle Drag End)
    useEffect(() => {
        if (!map || !marker || !panorama) return;

        // Sync marker to panorama
        const updatePosition = () => {
            const position = panorama.getPosition();
            if (position) {
                map.setCenter(position);
                marker.position = position;
            }
        };

        const listener = panorama.addListener('position_changed', updatePosition);

        // Handle Marker Drag End
        const dragEndListener = marker.addListener('dragend', () => {
            const newPos = marker.position;
            if (newPos) {
                // Convert position to LatLng if it's not already
                const latLng = newPos instanceof google.maps.LatLng
                    ? newPos
                    : new google.maps.LatLng(newPos.lat, newPos.lng);
                teleportTo(latLng);
                // Optional: Flash marker for feedback
                const content = marker.content as HTMLElement;
                if (content) {
                    const originalTransform = content.style.transform;
                    content.style.transform = `scale(1.5) ${originalTransform}`;
                    setTimeout(() => {
                        content.style.transform = originalTransform;
                    }, 200);
                }
            }
        });

        // Handle Map Click
        const mapClickListener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
            if (e.latLng) {
                teleportTo(e.latLng);
            }
        });

        // Handle Map Double Click
        const mapDblClickListener = map.addListener("dblclick", (e: google.maps.MapMouseEvent) => {
            if (e.latLng) {
                teleportTo(e.latLng);
            }
        });


        // Initial sync
        updatePosition();

        return () => {
            google.maps.event.removeListener(listener);
            google.maps.event.removeListener(dragEndListener);
            google.maps.event.removeListener(mapClickListener);
            google.maps.event.removeListener(mapDblClickListener);
        };
    }, [map, marker, panorama, teleportTo]);


    // Sync Marker Heading
    useEffect(() => {
        if (!marker) return;

        const content = marker.content as HTMLElement;
        if (content) {
            content.style.transform = `rotate(${heading}deg)`;
        }
    }, [heading, marker]);

    // Render Breadcrumbs
    useEffect(() => {
        if (!map) return;

        // Clear old markers
        breadcrumbMarkersRef.current.forEach(m => m.map = null);
        breadcrumbMarkersRef.current = [];

        // Add new markers
        breadcrumbs.forEach((pos, index) => {
            const crumbContent = document.createElement('div');
            crumbContent.style.cssText = `
                 width: 8px; height: 8px; background: #888; border-radius: 50%; 
                 border: 1px solid #fff; cursor: pointer;
             `;

            // Guard against AdvancedMarkerElement not being available
            if (window.google?.maps?.marker?.AdvancedMarkerElement) {
                const crumb = new google.maps.marker.AdvancedMarkerElement({
                    map: map,
                    position: pos,
                    title: `Previous Location ${index + 1}`,
                    content: crumbContent,
                });

                crumb.addListener("click", () => {
                    panorama.setPosition(pos);
                });

                breadcrumbMarkersRef.current.push(crumb);
            } else {
                // Fallback to standard marker if AdvancedMarkerElement not available
                const crumb = new google.maps.Marker({
                    map: map,
                    position: pos,
                    title: `Previous Location ${index + 1}`,
                }) as any;

                crumb.addListener("click", () => {
                    panorama.setPosition(pos);
                });

                breadcrumbMarkersRef.current.push(crumb);
            }
        });

    }, [breadcrumbs, map, panorama]); // Re-render when breadcrumbs change

    // Render Route Path with optimization to reuse the Polyline object
    useEffect(() => {
        if (!map) return;

        if (routePath && routePath.length > 0) {
            if (routeLineRef.current) {
                // OPTIMIZATION: Instead of re-instantiating, just update the path
                // This reduces GC pressure and improves performance during active routing
                routeLineRef.current.setPath(routePath);

                // Ensure it's attached to the current map instance
                if (routeLineRef.current.getMap() !== map) {
                    routeLineRef.current.setMap(map);
                }
            } else {
                // Create new polyline only if it doesn't exist yet
                routeLineRef.current = new google.maps.Polyline({
                    path: routePath,
                    geodesic: true,
                    strokeColor: "#FF0000", // Red for visibility
                    strokeOpacity: 0.8,
                    strokeWeight: 4,
                    map: map,
                    zIndex: 1, // Ensure it's above the map tiles but below markers
                });
            }
        } else {
            // Remove existing line if path is cleared
            if (routeLineRef.current) {
                routeLineRef.current.setMap(null);
                routeLineRef.current = null;
            }
        }
    }, [routePath, map]);

    // Add/Remove Crypto Company Markers
    useEffect(() => {
        // Clear existing crypto markers
        cryptoMarkersRef.current.forEach(marker => {
            if (marker instanceof google.maps.marker.AdvancedMarkerElement) {
                marker.map = null;
            } else if (cesiumViewer && marker instanceof Cesium.Entity) {
                cesiumViewer.entities.remove(marker);
            }
        });
        cryptoMarkersRef.current = [];

        if (!showCryptoMarkers) return;

        if (viewMode === 'map' && map) {
            // Add Google Maps markers
            CRYPTO_COMPANIES.forEach((company) => {
                const content = document.createElement('div');
                content.style.cssText = `
                    width: 20px; height: 20px; background: #FFD700; border-radius: 50%;
                    border: 2px solid #000; display: flex; align-items: center; justify-content: center;
                    font-size: 10px; color: #000; font-weight: bold; cursor: pointer;
                `;
                content.textContent = '₿'; // Bitcoin symbol
                content.title = `${company.name}: ${company.description}`;

                if (window.google?.maps?.marker?.AdvancedMarkerElement) {
                    const marker = new google.maps.marker.AdvancedMarkerElement({
                        map: map,
                        position: { lat: company.lat, lng: company.lng },
                        title: `${company.name}: ${company.description}`,
                        content,
                    });

                    marker.addListener('click', () => {
                        // Teleport to crypto company location
                        const latLng = new google.maps.LatLng(company.lat, company.lng);
                        teleportTo(latLng);
                    });

                    cryptoMarkersRef.current.push(marker);
                }
            });
        } else if (viewMode === 'globe' && cesiumViewer) {
            // Add Cesium entities
            CRYPTO_COMPANIES.forEach((company) => {
                const entity = cesiumViewer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(company.lng, company.lat),
                    billboard: {
                        image: 'data:image/svg+xml;base64,' + btoa(`
                            <svg width="24" height="24" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="12" cy="12" r="10" fill="#FFD700" stroke="#000" stroke-width="2"/>
                                <text x="12" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="#000">₿</text>
                            </svg>
                        `),
                        scale: 0.5,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    },
                    label: {
                        text: company.name,
                        font: '12pt sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 2,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        pixelOffset: new Cesium.Cartesian2(0, -32),
                    },
                });

                // Add click handler for teleportation
                entity.description = new Cesium.ConstantProperty(company.description);

                cryptoMarkersRef.current.push(entity);
            });
        }
    }, [showCryptoMarkers, viewMode, map, cesiumViewer, teleportTo]);

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            {viewMode === 'map' && (
                <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
            )}
            {viewMode === 'globe' && (
                <div ref={cesiumRef} style={{ width: '100%', height: '100%' }} />
            )}
        </div>
    );
};

export default MiniMap;
