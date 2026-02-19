import React, { useEffect, useRef, useState } from 'react';

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

        if (!(window as any).google?.maps) {  // Stricter check to prevent double-load
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&libraries=marker`;  // Stable v=weekly + marker lib
            script.async = true;
            script.defer = true;
            script.onload = () => {
                if (!isMounted) return;
                cleanup = initialize();
            };
            document.head.appendChild(script);  // Use head, not body
        } else {
            cleanup = initialize();
        }

        function initialize() {
            if (!panoRef.current) return null;

            // Setup Google Maps services
            const mapDiv = document.createElement('div');
            const mapInstance = new google.maps.Map(mapDiv, {
                center: startLocation,
                zoom: 12,
            });

            const panoInstance = new google.maps.StreetViewPanorama(panoRef.current!, {
                position: startLocation,
                pov: { heading: 34, pitch: 10 },
                zoom: 1,
                showRoadLabels: false,
                disableDefaultUI: true,
                motionTracking: false,
                motionTrackingControl: false
            });

            mapInstance.setStreetView(panoInstance);

            if (onPanoramaReady) onPanoramaReady(panoInstance);

            // --- Robust Canvas Detection ---
            // Instead of polling, we check whenever the DOM changes (e.g., new tiles loaded)
            const checkForCanvas = () => {
                if (!panoRef.current) return;

                const canvases = Array.from(panoRef.current.getElementsByTagName('canvas'));
                
                if (canvases.length === 0) return;

                // 1. Sort canvases by area (Width * Height) descending
                // Google Maps often creates multiple canvases; the main view is usually the largest.
                canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height));
                
                const bestCanvas = canvases[0];

                // 2. Filter out invalid or tiny canvases (loading placeholders)
                if (bestCanvas.width < 100 || bestCanvas.height < 100) return;

                // 3. Only notify if the canvas element reference has changed
                // Note: If the *same* canvas changes dimensions, the Renderer handles it 
                // by checking .width/.height every frame. We only need to notify App if the *element* changes.
                if (bestCanvas !== activeCanvasRef.current) {
                    console.log(`[StreetView] New active canvas found: ${bestCanvas.width}x${bestCanvas.height}`);
                    activeCanvasRef.current = bestCanvas;
                    onCanvasReady(bestCanvas);
                }
            };

            // Initial check
            checkForCanvas();

            // Observe DOM changes (e.g. when moving to a new Pano, GMaps might swap canvases)
            const observer = new MutationObserver((mutations) => {
                checkForCanvas();
            });

            observer.observe(panoRef.current, { 
                childList: true, 
                subtree: true, 
                attributes: true, // Also watch for attribute changes (like width/height)
                attributeFilter: ['width', 'height', 'style'] 
            });

            // Cleanup observer on unmount
            return () => {
                observer.disconnect();
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
    const handleMoveForward = () => {};

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
                }}
            />
        </div>
    );
};

export default StreetView;
