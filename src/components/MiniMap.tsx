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
    const [marker, setMarker] = useState<google.maps.marker.AdvancedMarkerElement | null>(null);
    const [breadcrumbs, setBreadcrumbs] = useState<google.maps.LatLng[]>([]);
    const breadcrumbMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
    const routeLineRef = useRef<google.maps.Polyline | null>(null);

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


    // Initialize Map
    useEffect(() => {
        if (!mapRef.current || map) return;

        const initMap = () => {
            const position = panorama.getPosition();
            if (!position) return;

            const newMap = new google.maps.Map(mapRef.current!, {
                center: position,
                zoom: 16,
                mapId: 'DEMO_MAP_ID',  // Required for AdvancedMarker
                streetViewControl: false,
                mapTypeControl: false,
                fullscreenControl: false,
                disableDefaultUI: true,
                clickableIcons: false, // Prevent clicking on POIs from hijacking
                // NOTE: Custom styles are managed via Cloud Console when mapId is present
                // Removing inline styles to avoid conflict with mapId
            });

            // Enable Street View Coverage Layer
            const coverageLayer = new google.maps.StreetViewCoverageLayer();
            coverageLayer.setMap(newMap);

            // Add marker - guard against AdvancedMarkerElement not being available
            let newMarker: google.maps.marker.AdvancedMarkerElement | null = null;
            if (window.google?.maps?.marker?.AdvancedMarkerElement) {
                newMarker = new google.maps.marker.AdvancedMarkerElement({
                    map: newMap,
                    position: position,
                    title: "Drag to move (You are here) 🖱️",
                    gmpDraggable: true,  // Enables drag (AdvancedMarker prop)
                    content: createMarkerContent(heading),  // Custom arrow/glow via content
                });
            } else {
                console.warn('[MiniMap] AdvancedMarkerElement not available, using standard marker');
                // Fallback to standard marker if AdvancedMarkerElement not available
                newMarker = new google.maps.Marker({
                    map: newMap,
                    position: position,
                    title: "Drag to move (You are here) 🖱️",
                    draggable: true,
                }) as any;
            }

            setMap(newMap);
            setMarker(newMarker);
        };

        if (window.google && window.google.maps) {
            initMap();
        }
    }, [panorama, map, heading]); // Dependencies

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
