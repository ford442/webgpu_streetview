import React, { useRef, useEffect, useState } from 'react';

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
    const [routePolyline, setRoutePolyline] = useState<google.maps.Polyline | null>(null);

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

            // Add marker
            const newMarker = new google.maps.Marker({
                position: position,
                map: newMap,
                icon: {
                    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                    scale: 5,
                    fillColor: "#00CCFF",
                    fillOpacity: 1,
                    strokeWeight: 2,
                    rotation: heading,
                    anchor: new google.maps.Point(0, 2.5) // Adjust anchor to center of arrow
                },
                title: "You are here"
            });

            setMap(newMap);
            setMarker(newMarker);

            // Add Click Listener for Navigation
            newMap.addListener("click", (e: google.maps.MapMouseEvent) => {
                if (e.latLng && panorama) {
                    panorama.setPosition(e.latLng);
                }
            });
        };

        if (window.google && window.google.maps) {
            initMap();
        }
    }, [panorama, map, heading]); // Dependencies

    // Sync Map with Panorama Position
    useEffect(() => {
        if (!map || !marker || !panorama) return;

        const updatePosition = () => {
            const position = panorama.getPosition();
            if (position) {
                map.setCenter(position);
                marker.setPosition(position);
            }
        };

        const listener = panorama.addListener('position_changed', updatePosition);
        // Initial sync
        updatePosition();

        return () => {
            google.maps.event.removeListener(listener);
        };
    }, [map, marker, panorama]);


    // Sync Marker Heading
    useEffect(() => {
        if (!marker) return;

        const icon = marker.getIcon() as google.maps.Symbol;
        if (icon) {
            icon.rotation = heading;
            marker.setIcon(icon);
        }
    }, [heading, marker]);
    
    // Draw route path on map
    useEffect(() => {
        if (!map) return;
        
        let polyline: google.maps.Polyline | null = null;
        
        // Clear existing polyline
        if (routePolyline) {
            routePolyline.setMap(null);
        }
        
        // Draw new route if available
        if (routePath && routePath.length > 0) {
            polyline = new google.maps.Polyline({
                path: routePath,
                geodesic: true,
                strokeColor: '#00CCFF',
                strokeOpacity: 0.8,
                strokeWeight: 4,
                map: map
            });
            
            setRoutePolyline(polyline);
            
            // Fit map bounds to show entire route
            const bounds = new google.maps.LatLngBounds();
            routePath.forEach(point => bounds.extend(point));
            map.fitBounds(bounds);
        } else {
            setRoutePolyline(null);
        }
        
        // Cleanup
        return () => {
            if (polyline) {
                polyline.setMap(null);
            }
        };
    }, [map, routePath, routePolyline]);

    return (
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    );
};

export default MiniMap;
