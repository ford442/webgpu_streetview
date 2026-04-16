import React, { useEffect, useRef } from 'react';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    apiKey: string;
    initialPosition?: { lat: number; lng: number };
    onPanoramaReady?: (panorama: google.maps.StreetViewPanorama) => void;
}

// Global callback for Google Maps async loading
declare global {
    interface Window {
        initGoogleMaps?: () => void;
        google?: typeof google;
    }
}

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, apiKey, initialPosition, onPanoramaReady }) => {
    const panoRef = useRef<HTMLDivElement>(null);
    const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const isInitializedRef = useRef(false);

    const startLocation = initialPosition ?? { lat: 39.2575004, lng: -121.021821 };

    useEffect(() => {
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;

        let isMounted = true;
        let cleanup: (() => void) | null = null;
        let observer: MutationObserver | null = null;

        const initialize = () => {
            if (!isMounted || !panoRef.current) return null;
            if (!window.google?.maps?.Map) {
                console.error('[StreetView] Google Maps API not available');
                return null;
            }

            // Create a temporary hidden map div
            const mapDiv = document.createElement('div');
            mapDiv.style.position = 'absolute';
            mapDiv.style.pointerEvents = 'none';
            mapDiv.style.visibility = 'hidden';
            mapDiv.style.width = '0';
            mapDiv.style.height = '0';
            document.body.appendChild(mapDiv);

            try {
                const mapInstance = new google.maps.Map(mapDiv, {
                    center: startLocation,
                    zoom: 12,
                    disableDefaultUI: true,
                });

                const panoInstance = new google.maps.StreetViewPanorama(panoRef.current, {
                    position: startLocation,
                    pov: { heading: 34, pitch: 10 },
                    zoom: 1,
                    showRoadLabels: false,
                    disableDefaultUI: true,
                    motionTracking: false,
                    motionTrackingControl: false,
                    addressControl: false,
                    fullscreenControl: false,
                    panControl: false,
                    zoomControl: false,
                    linksControl: false,
                });

                mapInstance.setStreetView(panoInstance);

                if (onPanoramaReady) onPanoramaReady(panoInstance);

                // Canvas detection with retry
                const checkForCanvas = () => {
                    if (!panoRef.current) return;

                    const canvases = panoRef.current.getElementsByTagName('canvas');
                    const len = canvases.length;
                    if (len === 0) return;

                    let bestCanvas = canvases[0];
                    let maxArea = bestCanvas.width * bestCanvas.height;

                    for (let i = 1; i < len; i++) {
                        const canvas = canvases[i];
                        const area = canvas.width * canvas.height;
                        if (area > maxArea) {
                            maxArea = area;
                            bestCanvas = canvas;
                        }
                    }

                    if (bestCanvas.width < 256 || bestCanvas.height < 256) return;

                    if (bestCanvas !== activeCanvasRef.current) {
                        console.log(`[StreetView] Canvas ready: ${bestCanvas.width}×${bestCanvas.height}`);
                        activeCanvasRef.current = bestCanvas;
                        onCanvasReady(bestCanvas);
                    }
                };

                // Initial check with delay
                const initialTimeout = setTimeout(checkForCanvas, 500);
                
                // Retry a few times for canvas detection
                const retryInterval = setInterval(checkForCanvas, 200);
                setTimeout(() => clearInterval(retryInterval), 3000);

                observer = new MutationObserver(() => {
                    checkForCanvas();
                });

                observer.observe(panoRef.current, {
                    childList: true,
                    subtree: true
                });

                return () => {
                    clearTimeout(initialTimeout);
                    clearInterval(retryInterval);
                    if (mapDiv.parentElement) {
                        mapDiv.parentElement.removeChild(mapDiv);
                    }
                };
            } catch (err) {
                console.error('[StreetView] Initialization error:', err);
                if (mapDiv.parentElement) {
                    mapDiv.parentElement.removeChild(mapDiv);
                }
                return null;
            }
        };

        // Load Google Maps API if not already loaded
        if (!window.google?.maps) {
            // Set up global callback
            window.initGoogleMaps = () => {
                if (isMounted) {
                    cleanup = initialize();
                }
            };

            const script = document.createElement('script');
            // Use callback pattern for reliable loading
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&callback=initGoogleMaps&libraries=marker`;
            script.async = true;
            script.onerror = () => {
                console.error('[StreetView] Failed to load Google Maps API');
            };
            document.head.appendChild(script);
        } else {
            cleanup = initialize();
        }

        return () => {
            isMounted = false;
            if (observer) {
                observer.disconnect();
            }
            if (cleanup) {
                cleanup();
            }
        };
    }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps -- onCanvasReady, onPanoramaReady, and startLocation are intentionally omitted: the Google Maps instance should only be created once per apiKey, not recreated on every parent render

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div
                ref={panoRef}
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    opacity: 1,
                    pointerEvents: 'none',
                    backgroundColor: '#000',
                }}
            />
        </div>
    );
};

export default StreetView;
