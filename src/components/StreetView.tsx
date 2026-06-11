import React, { useEffect, useRef } from 'react';
import { loadMapsApi, removeFailedBootstrap } from '../services/maps/loader';
import { getCanvasFingerprint } from '../hooks/useStreetView';

export type MapsLoadStatus =
    | 'idle'
    | 'loading-api'
    | 'api-ready'
    | 'api-error'
    | 'loading-panorama'
    | 'canvas-ready'
    | 'canvas-timeout'
    | 'rendering';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    apiKey: string;
    initialPosition?: { lat: number; lng: number };
    onPanoramaReady?: (panorama: google.maps.StreetViewPanorama) => void;
    onError?: (message: string) => void;
    onStatusChange?: (status: MapsLoadStatus) => void;
}

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, apiKey, initialPosition, onPanoramaReady, onError, onStatusChange }) => {
    const panoRef = useRef<HTMLDivElement>(null);
    const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const isInitializedRef = useRef(false);
    const lastKeyRef = useRef<string>('');

    // P1 stability tracking: do not hand a canvas to the renderer until its *content*
    // has produced N consecutive identical good fingerprints. This prevents flashing
    // low-res tiles, black frames, or transient Google internal canvases during init,
    // pano loads, or network hiccups.
    const lastFingerprintRef = useRef<string>('');
    const stableCountRef = useRef<number>(0);
    const everSawCandidateRef = useRef(false);
    const REQUIRED_STABLE_SAMPLES = 2; // ~400 ms at current 200 ms polling cadence

    const startLocation = initialPosition ?? { lat: 37.86926, lng: -122.254811 };

    useEffect(() => {
        const trimmed = (apiKey || '').trim();
        if (!trimmed) {
            // Do not initialize (or keep previous) with empty/placeholder key.
            // This allows a late-arriving key (see #84) to trigger a clean init.
            onStatusChange?.('idle');
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
        onStatusChange?.('loading-api');

        let isMounted = true;
        let cleanup: (() => void) | null = null;
        let observer: MutationObserver | null = null;

        const initialize = () => {
            if (!isMounted || !panoRef.current) return null;
            if (!window.google?.maps?.Map) {
                console.error('[StreetView] Google Maps API not available');
                onStatusChange?.('api-error');
                return null;
            }

            onStatusChange?.('loading-panorama');

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
                // Do NOT set a mapId unless a real Cloud Map ID is configured.
                // Any mapId (including 'DEMO_MAP_ID') causes Maps to issue a
                // MapsConfigService request that gets blocked by the server's
                // Cross-Origin-Embedder-Policy: require-corp header, triggering
                // the "can't load Google Maps correctly" error UI.
                const mapOptions: google.maps.MapOptions = {
                    center: startLocation,
                    zoom: 12,
                    disableDefaultUI: true,
                    ...(process.env.REACT_APP_GOOGLE_MAPS_MAP_ID
                        ? { mapId: process.env.REACT_APP_GOOGLE_MAPS_MAP_ID }
                        : {}),
                };
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
                        onStatusChange?.('canvas-timeout');
                        onError?.(`Street View unavailable: ${status}`);
                    }
                });

                if (onPanoramaReady) onPanoramaReady(panoInstance);

                // Canvas detection with retry + P1 stability gate (see repro + analysis for "map API loading error flickering").
                // We only promote a canvas (and thus feed it to WebGPU copyExternalImageToTexture + the render loop)
                // after it has shown the same usable fingerprint for REQUIRED_STABLE_SAMPLES consecutive checks.
                // This stops the renderer from ever seeing a partially decoded tile, a black/near-black frame,
                // or a short-lived internal Google canvas during initial load, pano transitions, cruise jumps,
                // or transient network / tile errors.
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

                    if (bestCanvas.width < 256 || bestCanvas.height < 256) {
                        // Too small — Google is probably still creating/replacing it.
                        stableCountRef.current = 0;
                        return;
                    }

                    everSawCandidateRef.current = true;

                    const fp = getCanvasFingerprint(bestCanvas);
                    if (!fp) {
                        // Content not usable yet (black, low-res preview, still decoding, noisy).
                        stableCountRef.current = 0;
                        lastFingerprintRef.current = '';
                        return;
                    }

                    const sameElement = bestCanvas === activeCanvasRef.current;
                    const sameFp = fp === lastFingerprintRef.current;

                    if (!sameFp) {
                        lastFingerprintRef.current = fp;
                        stableCountRef.current = 1;
                    } else {
                        stableCountRef.current = Math.min(stableCountRef.current + 1, REQUIRED_STABLE_SAMPLES + 1);
                    }

                    const isStable = stableCountRef.current >= REQUIRED_STABLE_SAMPLES;

                    if (isStable) {
                        if (!sameElement) {
                            console.log(`[StreetView] Canvas stable (${stableCountRef.current} samples): ${bestCanvas.width}×${bestCanvas.height} fp=${fp}`);
                            activeCanvasRef.current = bestCanvas;
                            onStatusChange?.('canvas-ready');
                            onCanvasReady(bestCanvas);
                        } else if (!sameFp) {
                            // Same canvas element, but content fingerprint changed and is now stable again
                            // (e.g. Google finished loading better tiles into the existing canvas).
                            console.log(`[StreetView] Canvas content restabilized: ${bestCanvas.width}×${bestCanvas.height}`);
                            onCanvasReady(bestCanvas);
                        }
                    } else {
                        // Candidate seen but not yet stable — do not promote.
                        if (stableCountRef.current === 1) {
                            console.log(`[StreetView] Canvas candidate ${bestCanvas.width}×${bestCanvas.height} (waiting for stability, fp=${fp})`);
                        }
                    }
                };

                // Initial check with delay
                const initialTimeout = setTimeout(checkForCanvas, 500);
                
                // Retry/polling window for canvas + stability. Extended so we can wait for
                // fingerprint stability instead of promoting the first 256px canvas we see.
                const retryInterval = setInterval(checkForCanvas, 200);
                const retryTimeout = setTimeout(() => clearInterval(retryInterval), 6000);

                // Hard timeout: if we never managed to promote a *stable* canvas, surface an error.
                // We give it a bit longer than before because we now require content stability.
                const canvasTimeout = setTimeout(() => {
                    if (!activeCanvasRef.current) {
                        const found = panoRef.current
                            ? Array.from(panoRef.current.getElementsByTagName('canvas'))
                                  .map(c => `${c.width}×${c.height}`)
                                  .join(', ') || 'none'
                            : 'pano div missing';
                        const sawCandidates = everSawCandidateRef.current;
                        const msg = sawCandidates
                            ? `Canvas detection timed out waiting for stable imagery (saw candidates: ${found}). The panorama may be slow to load or unavailable.`
                            : `Canvas detection timed out (found: ${found}) — Street View may be unavailable at this location.`;
                        console.error('[StreetView]', msg);
                        onStatusChange?.('canvas-timeout');
                        onError?.(msg);
                    }
                }, 6500);

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
                onStatusChange?.('api-error');
                if (mapDiv.parentElement) {
                    mapDiv.parentElement.removeChild(mapDiv);
                }
                return null;
            }
        };

        // Load Google Maps API via singleton loader (idempotent, no callback, no libraries)
        loadMapsApi(apiKey).then(() => {
            if (isMounted) {
                onStatusChange?.('api-ready');
                cleanup = initialize();
            }
        }).catch((err) => {
            if (isMounted) {
                console.error('[StreetView] Maps API load failed:', err);
                onStatusChange?.('api-error');
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
