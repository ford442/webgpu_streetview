import React, { useEffect, useRef } from 'react';
import { loadMapsApi, removeFailedBootstrap } from '../services/maps/loader';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    apiKey: string;
    initialPosition?: { lat: number; lng: number };
    onPanoramaReady?: (panorama: google.maps.StreetViewPanorama) => void;
    onError?: (message: string) => void;
}

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, apiKey, initialPosition, onPanoramaReady, onError }) => {
    const panoRef = useRef<HTMLDivElement>(null);
    const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const isInitializedRef = useRef(false);
    const lastKeyRef = useRef<string>('');

    const startLocation = initialPosition ?? { lat: 37.86926, lng: -122.254811 };

    useEffect(() => {
        const trimmed = (apiKey || '').trim();
        if (!trimmed) {
            // Do not initialize (or keep previous) with empty/placeholder key.
            // This allows a late-arriving key (see #84) to trigger a clean init.
            return;
        }
        if (isInitializedRef.current && lastKeyRef.current === trimmed) {
            return;
        }
        // Key changed (including first real key after empty start) — reset so we re-initialize.
        if (trimmed !== lastKeyRef.current) {
            isInitializedRef.current = false;
            removeFailedBootstrap();
        }
        lastKeyRef.current = trimmed;
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

            // Off-screen container for the linked Map instance.
            // Must have real pixel dimensions — a 0×0 or visibility:hidden div
            // prevents Google Maps from initialising its WebGL context, which in
            // turn stops the StreetViewPanorama from rendering its canvas (#87).
            const mapDiv = document.createElement('div');
            mapDiv.setAttribute('aria-hidden', 'true');
            mapDiv.style.position = 'fixed';
            mapDiv.style.left = '-10000px';
            mapDiv.style.top = '0';
            mapDiv.style.width = '640px';
            mapDiv.style.height = '480px';
            mapDiv.style.pointerEvents = 'none';
            mapDiv.style.opacity = '0';
            document.body.appendChild(mapDiv);

            try {
                // Only pass mapId when a registered Cloud Map ID is configured.
                // The placeholder 'webgpu-streetview-default' is NOT a registered ID
                // and causes failing MapsConfigService requests on every page load.
                const mapOptions: google.maps.MapOptions = {
                    center: startLocation,
                    zoom: 12,
                    disableDefaultUI: true,
                };
                if (process.env.REACT_APP_GOOGLE_MAPS_MAP_ID) {
                    mapOptions.mapId = process.env.REACT_APP_GOOGLE_MAPS_MAP_ID;
                }
                const mapInstance = new google.maps.Map(mapDiv, mapOptions);

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

                // Listen for panorama status changes (e.g. imagery unavailable)
                panoInstance.addListener('status_changed', () => {
                    const status = panoInstance.getStatus();
                    if (status !== google.maps.StreetViewStatus.OK) {
                        console.warn('[StreetView] Panorama status:', status);
                        onError?.(`Street View unavailable: ${status}`);
                    }
                });

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
                const retryTimeout = setTimeout(() => clearInterval(retryInterval), 3000);

                // Hard timeout: if no canvas detected after ~3.5s, surface an error
                const canvasTimeout = setTimeout(() => {
                    if (!activeCanvasRef.current) {
                        const found = panoRef.current
                            ? Array.from(panoRef.current.getElementsByTagName('canvas'))
                                  .map(c => `${c.width}×${c.height}`)
                                  .join(', ') || 'none'
                            : 'pano div missing';
                        const msg = `Canvas detection timed out (found: ${found}) — Street View may be unavailable at this location.`;
                        console.error('[StreetView]', msg);
                        onError?.(msg);
                    }
                }, 3500);

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
                    clearTimeout(retryTimeout);
                    clearTimeout(canvasTimeout);
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

        // Load Google Maps API via singleton loader (idempotent, no callback, no libraries)
        loadMapsApi(apiKey).then(() => {
            if (isMounted) {
                cleanup = initialize();
            }
        }).catch((err) => {
            if (isMounted) {
                console.error('[StreetView] Maps API load failed:', err);
                onError?.('Failed to load Google Maps API. Please check your API key and network connection.');
            }
        });

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
