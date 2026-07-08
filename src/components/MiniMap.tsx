import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// Import crypto companies config
import { CRYPTO_COMPANIES } from '../config/cryptoCompanies';

interface MiniMapProps {
    apiKey: string;
    panorama: google.maps.StreetViewPanorama;
    heading: number;
    routePath?: google.maps.LatLng[] | null;
    viewMode?: 'map' | 'globe';
    showCryptoMarkers?: boolean;
    /** Hold-pause aware teleport — must route through StreetViewProvider. */
    onTeleport?: (lat: number, lng: number) => void;
}

const MiniMap: React.FC<MiniMapProps> = ({
    apiKey,
    panorama,
    heading,
    routePath,
    viewMode = 'map',
    showCryptoMarkers = false,
    onTeleport,
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

    /** Create a heading-aware marker element */
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
        el.title = "Drag to move (You are here)";
        return el;
    };

    // Helper to add a breadcrumb at the current panorama position
    const addBreadcrumb = useCallback(() => {
        const position = panorama.getPosition();
        if (position) {
            setBreadcrumbs(prev => [...prev, position]);
        }
    }, [panorama]);

    const moveToPano = useCallback((data: google.maps.StreetViewPanoramaData, fallbackLatLng: google.maps.LatLng) => {
        addBreadcrumb();
        if (onTeleport) {
            const target = data.location?.latLng ?? fallbackLatLng;
            onTeleport(target.lat(), target.lng());
            return;
        }
        if (data.location?.pano) {
            panorama.setPano(data.location.pano);
        }
    }, [addBreadcrumb, onTeleport, panorama]);

    // Helper to move to a location (teleport)
    const teleportTo = useCallback((latLng: google.maps.LatLng | null) => {
        if (!latLng || !map) return;

        const sv = new google.maps.StreetViewService();
        sv.getPanorama({ location: latLng, radius: 50 }, (data, status) => {
            if (status === google.maps.StreetViewStatus.OK && data && data.location && data.location.pano) {
                moveToPano(data, latLng);
            } else {
                console.warn("No Street View found near this location.");
            }
        });
    }, [map, moveToPano]);


    // Initialize Google Maps 2D
    useEffect(() => {
        if (viewMode !== 'map' || !mapRef.current || map) return;

        const initMap = () => {
            const initialPos = panorama.getPosition();
            const center = initialPos ?? new google.maps.LatLng(0, 0);

            // Only pass mapId when a registered Cloud Map ID is configured.
            // The placeholder 'webgpu-streetview-default' is NOT a registered ID
            // and causes failing MapsConfigService requests on every map creation.
            const mapOptions: google.maps.MapOptions = {
                center,
                zoom: 18,
                mapTypeId: google.maps.MapTypeId.ROADMAP,
                streetViewControl: false,
                fullscreenControl: false,
                mapTypeControl: false,
                zoomControl: true,
                zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
                styles: [
                    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
                    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
                ],
            };
            if (process.env.REACT_APP_GOOGLE_MAPS_MAP_ID) {
                mapOptions.mapId = process.env.REACT_APP_GOOGLE_MAPS_MAP_ID;
            }

            const gMap = new google.maps.Map(mapRef.current!, mapOptions);

            // Note: StreetViewCoverageLayer is intentionally omitted — it
            // auto-fetches Street View tile imagery on every map load, which
            // adds billing volume without user action.

            // Create heading-aware marker
            let gMarker: google.maps.marker.AdvancedMarkerElement | google.maps.Marker | null = null;
            const rotation = heading;
            const markerContent = createMarkerContent(rotation);

            if (window.google?.maps?.marker?.AdvancedMarkerElement) {
                gMarker = new google.maps.marker.AdvancedMarkerElement({
                    map: gMap,
                    position: center,
                    title: 'You are here',
                    content: markerContent,
                    gmpDraggable: true,
                });
            } else {
                // Fallback to legacy Marker
                gMarker = new google.maps.Marker({
                    map: gMap,
                    position: center,
                    title: 'You are here',
                    icon: {
                        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                        scale: 4,
                        rotation,
                        fillColor: '#00CCFF',
                        fillOpacity: 1,
                        strokeColor: '#fff',
                        strokeWeight: 2,
                    },
                });
            }

            setMap(gMap);
            setMarker(gMarker as google.maps.marker.AdvancedMarkerElement);
        };

        initMap();

        return () => {
            setMap(null);
            setMarker(null);
        };
    }, [viewMode, map, panorama, heading]);

    // Initialize Cesium Globe
    useEffect(() => {
        const initCesium = async () => {
            if (viewMode !== 'globe' || !cesiumRef.current || cesiumViewer) return;

            try {
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

                viewer.camera.setView({
                    destination: Cesium.Cartesian3.fromDegrees(0, 0, 20000000),
                });

                setCesiumViewer(viewer);
            } catch (err) {
                console.warn('[MiniMap] Cesium init failed, falling back to 2D map:', err);
                // Fallback: the parent can detect this and switch viewMode to 'map'
            }
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
                if ('position' in marker) {
                    (marker as any).position = position;
                }
            }
        };

        const listener = panorama.addListener('position_changed', updatePosition);

        // Handle Marker Drag End
        const handleDragEnd = () => {
            const newPos = (marker as any).position;
            if (newPos) {
                const latLng = newPos instanceof google.maps.LatLng
                    ? newPos
                    : new google.maps.LatLng(newPos.lat, newPos.lng);
                teleportTo(latLng);
            }
        };

        if (marker instanceof google.maps.Marker) {
            marker.addListener('dragend', handleDragEnd);
        } else if (marker.addEventListener) {
            marker.addEventListener('dragend', handleDragEnd);
        }

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
            if (marker instanceof google.maps.Marker) {
                google.maps.event.clearListeners(marker, 'dragend');
            } else if (marker.removeEventListener) {
                marker.removeEventListener('dragend', handleDragEnd);
            }
            google.maps.event.removeListener(mapClickListener);
            google.maps.event.removeListener(mapDblClickListener);
        };
    }, [map, marker, panorama, teleportTo]);

    // Sync Marker Heading
    useEffect(() => {
        if (!marker) return;

        if ('content' in marker && marker.content) {
            (marker.content as HTMLElement).style.transform = `rotate(${heading}deg)`;
        } else if (marker instanceof google.maps.Marker) {
            const icon = marker.getIcon() as google.maps.Symbol;
            if (icon && 'rotation' in icon) {
                marker.setIcon({ ...icon, rotation: heading });
            }
        }
    }, [heading, marker]);

    // Render Breadcrumbs
    useEffect(() => {
        if (!map) return;

        // Clear old markers
        breadcrumbMarkersRef.current.forEach(m => m.map = null);

        // Add new markers - Optimized to create all markers first and set ref once
        breadcrumbMarkersRef.current = breadcrumbs.map((pos, index) => {
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
                    if (onTeleport) {
                        onTeleport(pos.lat(), pos.lng());
                    } else {
                        panorama.setPosition(pos);
                    }
                });

                return crumb;
            } else {
                // Fallback to standard marker if AdvancedMarkerElement not available
                const crumb = new google.maps.Marker({
                    map: map,
                    position: pos,
                    title: `Previous Location ${index + 1}`,
                }) as any;

                crumb.addListener("click", () => {
                    if (onTeleport) {
                        onTeleport(pos.lat(), pos.lng());
                    } else {
                        panorama.setPosition(pos);
                    }
                });

                return crumb;
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
        // Clear existing crypto markers. Guard the AdvancedMarkerElement access:
        // the `marker` library is no longer requested at load time, so
        // `google.maps.marker` is undefined and a direct property access throws.
        const AdvancedMarker = window.google?.maps?.marker?.AdvancedMarkerElement;
        cryptoMarkersRef.current.forEach(marker => {
            if (AdvancedMarker && marker instanceof AdvancedMarker) {
                marker.map = null;
            } else if (cesiumViewer && marker instanceof Cesium.Entity) {
                cesiumViewer.entities.remove(marker);
            }
        });
        cryptoMarkersRef.current = [];

        if (!showCryptoMarkers) return;

        if (viewMode === 'map' && map) {
            // Add Google Maps markers - Optimized to create all markers first and set ref once
            cryptoMarkersRef.current = CRYPTO_COMPANIES.map((company) => {
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

                    return marker;
                }
                return null;
            }).filter((m): m is google.maps.marker.AdvancedMarkerElement => m !== null);
        } else if (viewMode === 'globe' && cesiumViewer) {
            // Add Cesium entities - Optimized to create all entities first and set ref once
            cryptoMarkersRef.current = CRYPTO_COMPANIES.map((company) => {
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

                return entity;
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
