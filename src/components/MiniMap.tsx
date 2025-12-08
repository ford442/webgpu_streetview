import React, { useRef, useEffect, useState } from 'react';

interface MiniMapProps {
    apiKey: string;
    panorama: google.maps.StreetViewPanorama;
    heading: number;
}

const MiniMap: React.FC<MiniMapProps> = ({ apiKey, panorama, heading }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<google.maps.Map | null>(null);
    const [marker, setMarker] = useState<google.maps.Marker | null>(null);

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
        };

        if (window.google && window.google.maps) {
            initMap();
        }
    }, [panorama, map]); // Dependencies

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

    return (
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    );
};

export default MiniMap;
