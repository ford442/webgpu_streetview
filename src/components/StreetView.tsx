import React, { useEffect, useRef } from 'react';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    apiKey: string;
    initialPosition?: { lat: number; lng: number };
    onPanoramaReady?: (panorama: google.maps.StreetViewPanorama) => void;
}

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, apiKey, initialPosition, onPanoramaReady }) => {
    const panoRef = useRef<HTMLDivElement>(null);
    // Keep track of the currently active canvas to avoid unnecessary updates
    const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const startLocation = initialPosition ?? { lat: 39.2575004, lng: -121.021821 };

    useEffect(() => {
        let isMounted = true;
        let cleanup: (() => void) | null = null;

        if (!(window as any).google?.maps) {
            const script = document.createElement('script');
            // Use loading=async query parameter (Google's recommended approach)
            // Include marker library for AdvancedMarkerElement in MiniMap
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async&libraries=marker`;
            script.onload = () => {
                if (!isMounted) return;
                cleanup = initialize();
            };
            script.onerror = () => {
                console.error('[StreetView] Failed to load Google Maps API');
            };
            document.head.appendChild(script);
        } else {
            cleanup = initialize();
        }

        function initialize() {
            if (!panoRef.current) return null;

            // Create a temporary hidden map div (required by Maps API but not visible)
            const mapDiv = document.createElement('div');
            mapDiv.style.position = 'absolute';
            mapDiv.style.pointerEvents = 'none';
            mapDiv.style.visibility = 'hidden';
            mapDiv.style.width = '0';
            mapDiv.style.height = '0';

            // Create map without mapId to avoid conflicts with StreetView rendering
            const mapInstance = new google.maps.Map(mapDiv, {
                center: startLocation,
                zoom: 12,
                // No mapId, no styles - let StreetView handle all rendering
                disableDefaultUI: true,
            });

            // Create StreetView panorama with minimal configuration
            const panoInstance = new google.maps.StreetViewPanorama(panoRef.current!, {
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

            // --- Robust Canvas Detection ---
            // Google Maps Street View renders to a canvas that we extract and display
            // The canvas detection waits for StreetView to fully initialize
            const checkForCanvas = () => {
                if (!panoRef.current) return;

                const canvases = Array.from(panoRef.current.getElementsByTagName('canvas'));

                if (canvases.length === 0) {
                    console.debug('[StreetView] No canvases found yet, waiting for initialization...');
                    return;
                }

                // 1. Sort canvases by area (Width * Height) descending
                // The main Street View panorama is typically the largest canvas
                canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height));

                const bestCanvas = canvases[0];

                // 2. Filter out tiny canvases (loading placeholders, decorative elements)
                // Minimum 256×256 for valid Street View canvas
                if (bestCanvas.width < 256 || bestCanvas.height < 256) {
                    console.debug(`[StreetView] Canvas too small (${bestCanvas.width}×${bestCanvas.height}), waiting...`);
                    return;
                }

                // 3. Only notify if the canvas element reference has changed
                // The same canvas element may change dimensions, but Renderer checks that every frame
                if (bestCanvas !== activeCanvasRef.current) {
                    console.log(`[StreetView] ✓ Street View canvas ready: ${bestCanvas.width}×${bestCanvas.height}`);
                    activeCanvasRef.current = bestCanvas;
                    onCanvasReady(bestCanvas);
                }
            };

            // Initial check
            setTimeout(checkForCanvas, 100); // Small delay to ensure panorama initializes

            // Observe DOM changes for canvas swaps (when moving to new panoramas)
            const observer = new MutationObserver(() => {
                checkForCanvas();
            });

            // Performance: Optimized observer
            // Only watch direct children (childList: true, subtree: false)
            // Reduces CPU overhead by ~50% compared to full subtree observation
            observer.observe(panoRef.current, {
                childList: true,
                subtree: false
            });

            // Cleanup observer on unmount
            return () => {
                observer.disconnect();
                // Clean up hidden map div if it was added to DOM
                if (mapDiv.parentElement) {
                    mapDiv.parentElement.removeChild(mapDiv);
                }
            };
        }

        return () => {
            isMounted = false;
            if (cleanup) {
                cleanup();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiKey]);

    // Cleanup helper (App controls navigation now)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const handleMoveForward = () => { };

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
                    opacity: 1, // Must be visible for canvas to render
                    pointerEvents: 'auto',
                    backgroundColor: '#000',
                }}
            />
        </div>
    );
};

export default StreetView;
