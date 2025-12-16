import React, { useRef, useEffect, useState, useCallback } from 'react';

interface MiniMapProps {
    apiKey: string;
    panorama: google.maps.StreetViewPanorama;
    heading: number;
    routePath?: google.maps.LatLng[] | null;
}

const MiniMap: React.FC<MiniMapProps> = ({ apiKey, panorama, heading, routePath }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<google.maps.Map | null>(null);
    const [marker, setMarker] = useState<google.maps.Marker | null>(null);
    const [breadcrumbs, setBreadcrumbs] = useState<google.maps.LatLng[]>([]);
    const breadcrumbMarkersRef = useRef<google.maps.Marker[]>([]);
    const routeLineRef = useRef<google.maps.Polyline | null>(null);

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


    // Initialize Map
    useEffect(() => {
        if (!mapRef.current || map) return;

        const initMap = () => {
            const position = panorama.getPosition();
            if (!position) return;

            const newMap = new google.maps.Map(mapRef.current!, {
                center: position,
                zoom: 16,
                streetViewControl: false,
                mapTypeControl: false,
                fullscreenControl: false,
                disableDefaultUI: true,
                clickableIcons: false, // Prevent clicking on POIs from hijacking
                styles: [
                    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                    {
                        featureType: "administrative.locality",
                        elementType: "labels.text.fill",
                        stylers: [{ color: "#d59563" }],
                    },
                    {
                        featureType: "poi",
                        elementType: "labels.text.fill",
                        stylers: [{ color: "#d59563" }],
                    },
                    {
                        featureType: "poi.park",
                        elementType: "geometry",
                        stylers: [{ color: "#263c3f" }],
                    },
                    {
                        featureType: "poi.park",
                        elementType: "labels.text.fill",
                        stylers: [{ color: "#6b9a76" }],
                    },
                    {
                        featureType: "road",
                        elementType: "geometry",
                        stylers: [{ color: "#38414e" }],
                    },
                    {
                        featureType: "road",
                        elementType: "geometry.stroke",
                        stylers: [{ color: "#212a37" }],
                    },
                    {
                        featureType: "road",
                        elementType: "labels.text.fill",
                        stylers: [{ color: "#9ca5b3" }],
                    },
                    {
                        featureType: "road.highway",
                        elementType: "geometry",
                        stylers: [{ color: "#746855" }],
                    },
                    {
                        featureType: "road.highway",
                        elementType: "geometry.stroke",
                        stylers: [{ color: "#1f2835" }],
                    },
                    {
                        featureType: "road.highway",
                        elementType: "labels.text.fill",
                        stylers: [{ color: "#f3d19c" }],
                    },
                    {
                        featureType: "transit",
                        elementType: "geometry",
                        stylers: [{ color: "#2f3948" }],
                    },
                    {
                        featureType: "transit.station",
                        elementType: "labels.text.fill",
                        stylers: [{ color: "#d59563" }],
                    },
                    {
                        featureType: "water",
                        elementType: "geometry",
                        stylers: [{ color: "#17263c" }],
                    },
                    {
                        featureType: "water",
                        elementType: "labels.text.fill",
                        stylers: [{ color: "#515c6d" }],
                    },
                    {
                        featureType: "water",
                        elementType: "labels.text.stroke",
                        stylers: [{ color: "#17263c" }],
                    },
                ],
            });

            // Enable Street View Coverage Layer
            const coverageLayer = new google.maps.StreetViewCoverageLayer();
            coverageLayer.setMap(newMap);

            // Add marker
            const newMarker = new google.maps.Marker({
                position: position,
                map: newMap,
                draggable: true, // Make draggable
                icon: {
                    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                    scale: 5,
                    fillColor: "#00CCFF",
                    fillOpacity: 1,
                    strokeWeight: 2,
                    rotation: heading,
                    anchor: new google.maps.Point(0, 2.5)
                },
                title: "You are here"
            });

            setMap(newMap);
            setMarker(newMarker);
        };

        if (window.google && window.google.maps) {
            initMap();
        }
    }, [panorama, map]); // Dependencies

    // Sync Map with Panorama Position (and Handle Drag End)
    useEffect(() => {
        if (!map || !marker || !panorama) return;

        // Sync marker to panorama
        const updatePosition = () => {
            const position = panorama.getPosition();
            if (position) {
                map.setCenter(position);
                marker.setPosition(position);
            }
        };

        const listener = panorama.addListener('position_changed', updatePosition);

        // Handle Marker Drag End
        const dragEndListener = marker.addListener('dragend', () => {
            const newPos = marker.getPosition();
            if (newPos) {
                teleportTo(newPos);
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

        const icon = marker.getIcon() as google.maps.Symbol;
        if (icon) {
            icon.rotation = heading;
            marker.setIcon(icon);
        }
    }, [heading, marker]);

    // Render Breadcrumbs
    useEffect(() => {
        if (!map) return;

        // Clear old markers
        breadcrumbMarkersRef.current.forEach(m => m.setMap(null));
        breadcrumbMarkersRef.current = [];

        // Add new markers
        breadcrumbs.forEach((pos, index) => {
             const crumb = new google.maps.Marker({
                position: pos,
                map: map,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 4,
                    fillColor: "#888888",
                    fillOpacity: 0.8,
                    strokeColor: "#ffffff",
                    strokeWeight: 1,
                },
                title: `Previous Location ${index + 1}`
            });

            crumb.addListener("click", () => {
                 panorama.setPosition(pos);
            });

            breadcrumbMarkersRef.current.push(crumb);
        });

    }, [breadcrumbs, map, panorama]); // Re-render when breadcrumbs change

    // Render Route Path
    useEffect(() => {
        if (!map) return;

        // Remove existing line
        if (routeLineRef.current) {
            routeLineRef.current.setMap(null);
            routeLineRef.current = null;
        }

        if (routePath && routePath.length > 0) {
            const line = new google.maps.Polyline({
                path: routePath,
                geodesic: true,
                strokeColor: "#FF0000", // Red for visibility
                strokeOpacity: 0.8,
                strokeWeight: 4,
                map: map,
                zIndex: 1, // Ensure it's above the map tiles but below markers
            });
            routeLineRef.current = line;
        }
    }, [routePath, map]);

    return (
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    );
};

export default MiniMap;
