import React, { useEffect, useRef, useState } from 'react';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    apiKey: string;
    // New optional callback so parent (App) can receive the panorama instance
    onPanoramaReady?: (panorama: google.maps.StreetViewPanorama) => void;
}

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, apiKey, onPanoramaReady }) => {
    const panoRef = useRef<HTMLDivElement>(null);
    const [panorama, setPanorama] = useState<google.maps.StreetViewPanorama | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [canvasFound, setCanvasFound] = useState(false);

    const startLocation = { lat: 39.2575004, lng: -121.021821 };

    useEffect(() => {
        let checkForCanvas: number | null = null;

        if (!(window as any).google) {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=alpha`;
            script.async = true;
            script.defer = true;
            script.onload = initialize;
            document.body.appendChild(script);
        } else {
            initialize();
        }

        function initialize() {
            if (!panoRef.current) return;

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
            setPanorama(panoInstance);

            // Notify parent if requested
            if (onPanoramaReady) onPanoramaReady(panoInstance);

            // --- POLLING FOR VALID CANVAS ---
            // Keep checking because Google Maps might replace the canvas when moving
            let lastCanvas: HTMLCanvasElement | null = null;

            checkForCanvas = window.setInterval(() => {
                if (panoRef.current) {
                    const canvases = panoRef.current.getElementsByTagName('canvas');
                    if (canvases.length > 0) {
                        const canvas = canvases[0];
                        // Only accept if it has real dimensions (fixes the 1px stripe issue)
                        if (canvas.width > 100 && canvas.height > 100) {
                            // If it's a different canvas element, notify the parent
                            if (canvas !== lastCanvas) {
                                console.log(`[StreetView] New canvas detected: ${canvas.width}x${canvas.height}`);
                                lastCanvas = canvas;
                                onCanvasReady(canvas);
                                setCanvasFound(true);
                            }
                        }
                    }
                }
            }, 200);
        }

        return () => {
            if (checkForCanvas) {
                clearInterval(checkForCanvas);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiKey]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const handleMoveForward = () => {
        if (!panorama) return;
        const links = panorama.getLinks();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const pov = panorama.getPov();
        if (links) {
            // Simple logic: pick the first link that isn't roughly behind us
            // Real logic would calculate heading diff like your original code
            const next = links[0];

            if (next) panorama.setPano(next.pano as string);
        }
    };

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            {/* Pano Container */}
            <div
                ref={panoRef}
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    // Keep opacity at 1 so we get valid pixel data; hiding is handled by z-index in App.tsx
                    opacity: 1,
                    pointerEvents: 'auto',
                }}
            />

        </div>
    );
};


export default StreetView;
