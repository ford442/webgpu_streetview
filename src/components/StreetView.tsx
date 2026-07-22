import React, { useEffect, useRef } from 'react';
import { loadMapsApi, removeFailedBootstrap } from '../services/maps/loader';
import {
  getCanvasFingerprint,
  STABILITY_POLL_INTERVAL_MS,
  STABILITY_REQUIRED_STABLE_TICKS,
} from '../utils/panoramaStability';
import {
  createInitialScraperHealth,
  reduceScraperHealth,
  SCRAPER_CONTAINER_INVARIANTS,
  type ScraperHealth,
  type ScraperHealthEvent,
} from '../utils/scraperHealth';
import { streetViewProbe } from '../utils/streetViewProbe';

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
    /** Structured scrape health for AppShell / LoadingOverlay / probe. */
    onScraperHealth?: (health: ScraperHealth) => void;
}

function selectLargestCanvas(container: HTMLElement): {
    best: HTMLCanvasElement | null;
    canvasCount: number;
    selectedArea: number;
} {
    const canvases = container.getElementsByTagName('canvas');
    const canvasCount = canvases.length;
    if (canvasCount === 0) {
        return { best: null, canvasCount: 0, selectedArea: 0 };
    }
    let best = canvases[0]!;
    let maxArea = best.width * best.height;
    for (let i = 1; i < canvasCount; i++) {
        const c = canvases[i]!;
        const area = c.width * c.height;
        if (area > maxArea) {
            maxArea = area;
            best = c;
        }
    }
    return { best, canvasCount, selectedArea: maxArea };
}

const StreetView: React.FC<StreetViewProps> = ({
    onCanvasReady,
    apiKey,
    initialPosition,
    onPanoramaReady,
    onError,
    onStatusChange,
    onScraperHealth,
}) => {
    const panoRef = useRef<HTMLDivElement>(null);
    const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const isInitializedRef = useRef(false);
    const lastKeyRef = useRef<string>('');
    const lastFingerprintRef = useRef<string>('');
    const stableCountRef = useRef<number>(0);
    const everSawCandidateRef = useRef(false);
    const everPromotedRef = useRef(false);
    const healthRef = useRef<ScraperHealth>(createInitialScraperHealth());
    const panoInstanceRef = useRef<google.maps.StreetViewPanorama | null>(null);
    const REQUIRED_STABLE_SAMPLES = STABILITY_REQUIRED_STABLE_TICKS;
    const minEdge = SCRAPER_CONTAINER_INVARIANTS.minCanvasEdgePx;

    const errorSuppressorRef = useRef<MutationObserver | null>(null);
    const startLocation = initialPosition ?? { lat: 37.86926, lng: -122.254811 };

    const emitHealth = (event: ScraperHealthEvent) => {
        healthRef.current = reduceScraperHealth(healthRef.current, event);
        streetViewProbe.setScraperHealth(healthRef.current);
        onScraperHealth?.(healthRef.current);
    };

    // === Live Google Maps error UI suppressor ===
    useEffect(() => {
        const SUPPRESS_SEL = '[class*="gm-err"], .gm-err-container, .gm-err-content, .gm-err-icon, .gm-err-title, .gm-err-message, .gm-err-dialog, [aria-label*="Google Maps" i], [aria-label*="This page can\'t load" i], [aria-label*="load Google" i]';

        const suppress = () => {
            const container = panoRef.current;
            if (!container) return;
            const nodes = container.querySelectorAll(SUPPRESS_SEL);
            nodes.forEach((node) => {
                const el = node as HTMLElement;
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
                el.style.setProperty('opacity', '0', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
                el.style.setProperty('z-index', '-9999', 'important');
                if (el.parentNode) {
                    try { el.parentNode.removeChild(el); } catch {}
                }
            });
        };

        suppress();
        const t0 = setTimeout(suppress, 80);
        const t1 = setTimeout(suppress, 280);
        const t2 = setTimeout(suppress, 900);
        const t3 = setTimeout(suppress, 1800);

        let mo: MutationObserver | null = null;
        const attachObserver = () => {
            const container = panoRef.current;
            if (container && !mo) {
                mo = new MutationObserver(suppress);
                mo.observe(container, { childList: true, subtree: true });
                errorSuppressorRef.current = mo;
            }
        };
        const attachT = setTimeout(attachObserver, 0);

        return () => {
            clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(attachT);
            if (mo) {
                mo.disconnect();
                mo = null;
            }
            errorSuppressorRef.current = null;
        };
    }, []);

    useEffect(() => {
        const trimmed = (apiKey || '').trim();
        if (!trimmed) {
            onStatusChange?.('idle');
            return;
        }
        if (isInitializedRef.current && lastKeyRef.current === trimmed) {
            return;
        }
        if (trimmed !== lastKeyRef.current) {
            isInitializedRef.current = false;
            removeFailedBootstrap();
        }
        lastKeyRef.current = trimmed;
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;
        onStatusChange?.('loading-api');
        emitHealth({ type: 'reset' });
        everPromotedRef.current = false;
        everSawCandidateRef.current = false;
        activeCanvasRef.current = null;
        lastFingerprintRef.current = '';
        stableCountRef.current = 0;

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
            emitHealth({ type: 'locating' });

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
                panoInstanceRef.current = panoInstance;

                mapInstance.setStreetView(panoInstance);

                const suppressErrorChrome = () => {
                    if (!panoRef.current) return;
                    try {
                        const bad = panoRef.current.querySelectorAll(
                            '[class*="gm-err"], .gm-err-container, [aria-label*="Google" i]'
                        );
                        bad.forEach((n) => {
                            const e = n as HTMLElement;
                            e.style.setProperty('display', 'none', 'important');
                            e.style.setProperty('visibility', 'hidden', 'important');
                            e.style.setProperty('opacity', '0', 'important');
                            if (e.parentNode) { try { e.parentNode.removeChild(e); } catch {} }
                        });
                    } catch {}
                };

                const checkForCanvas = () => {
                    if (!panoRef.current) return;
                    suppressErrorChrome();

                    const { best, canvasCount, selectedArea } = selectLargestCanvas(panoRef.current);
                    const active = activeCanvasRef.current;

                    if (active && (!active.isConnected || !panoRef.current.contains(active))) {
                        console.warn('[StreetView] Active canvas detached — re-acquiring');
                        activeCanvasRef.current = null;
                        lastFingerprintRef.current = '';
                        stableCountRef.current = 0;
                        emitHealth({
                            type: 'lost',
                            reason: 'detached',
                            canvasCount,
                            selectedArea,
                        });
                    }

                    if (!best) {
                        emitHealth({
                            type: 'scan',
                            canvasCount: 0,
                            selectedArea: 0,
                            hasCandidate: false,
                            fingerprintOk: false,
                            rejectReason: 'no-canvas',
                        });
                        return;
                    }

                    const hasCandidate = best.width >= minEdge && best.height >= minEdge;
                    if (!hasCandidate) {
                        stableCountRef.current = 0;
                        emitHealth({
                            type: 'scan',
                            canvasCount,
                            selectedArea,
                            hasCandidate: false,
                            fingerprintOk: false,
                            rejectReason: 'zero-size',
                        });
                        return;
                    }

                    everSawCandidateRef.current = true;
                    const fp = getCanvasFingerprint(best);
                    if (!fp) {
                        stableCountRef.current = 0;
                        lastFingerprintRef.current = '';
                        emitHealth({
                            type: 'scan',
                            canvasCount,
                            selectedArea,
                            hasCandidate: true,
                            fingerprintOk: false,
                            rejectReason: 'near-black',
                        });
                        return;
                    }

                    emitHealth({
                        type: 'scan',
                        canvasCount,
                        selectedArea,
                        hasCandidate: true,
                        fingerprintOk: true,
                    });

                    const sameElement = best === activeCanvasRef.current;
                    const sameFp = fp === lastFingerprintRef.current;

                    if (!sameFp) {
                        lastFingerprintRef.current = fp;
                        stableCountRef.current = 1;
                    } else {
                        stableCountRef.current = Math.min(
                            stableCountRef.current + 1,
                            REQUIRED_STABLE_SAMPLES + 1
                        );
                    }

                    emitHealth({
                        type: 'tick',
                        sameFingerprint: sameFp,
                        canvasCount,
                        selectedArea,
                        requiredStableTicks: REQUIRED_STABLE_SAMPLES,
                    });

                    const isStable = stableCountRef.current >= REQUIRED_STABLE_SAMPLES;

                    if (isStable) {
                        if (!sameElement) {
                            console.log(
                                `[StreetView] Canvas stable (${stableCountRef.current} samples): ${best.width}×${best.height} fp=${fp}`
                            );
                            activeCanvasRef.current = best;
                            everPromotedRef.current = true;
                            onStatusChange?.('canvas-ready');
                            onCanvasReady(best);
                            emitHealth({ type: 'promoted', canvasCount, selectedArea });
                        } else if (!sameFp) {
                            console.log(
                                `[StreetView] Canvas content restabilized: ${best.width}×${best.height}`
                            );
                            onCanvasReady(best);
                            emitHealth({ type: 'promoted', canvasCount, selectedArea });
                        }
                    } else if (stableCountRef.current === 1) {
                        console.log(
                            `[StreetView] Canvas candidate ${best.width}×${best.height} (waiting for stability, fp=${fp})`
                        );
                    }
                };

                panoInstance.addListener('status_changed', () => {
                    const status = panoInstance.getStatus();
                    if (status !== google.maps.StreetViewStatus.OK) {
                        console.warn('[StreetView] Panorama status:', status);
                        onStatusChange?.('canvas-timeout');
                        onError?.(`Street View unavailable: ${status}`);
                        emitHealth({
                            type: 'timeout',
                            sawCandidates: everSawCandidateRef.current,
                            detail: `Street View unavailable: ${status}`,
                        });
                    }
                });

                panoInstance.addListener('pano_changed', () => {
                    checkForCanvas();
                });

                if (onPanoramaReady) onPanoramaReady(panoInstance);

                /** Lightweight idle self-check: Maps still painting + canvas still attached. */
                const selfCheck = () => {
                    if (!panoRef.current) return;
                    const active = activeCanvasRef.current;
                    const { best, canvasCount, selectedArea } = selectLargestCanvas(panoRef.current);
                    const attached = !!(
                        active &&
                        active.isConnected &&
                        panoRef.current.contains(active)
                    );
                    let fingerprintChanged = false;
                    if (attached && active) {
                        const fp = getCanvasFingerprint(active);
                        if (fp && lastFingerprintRef.current && fp !== lastFingerprintRef.current) {
                            fingerprintChanged = true;
                            lastFingerprintRef.current = fp;
                        }
                    }
                    emitHealth({
                        type: 'self_check',
                        canvasAttached: attached || (!everPromotedRef.current && !!best),
                        canvasCount,
                        selectedArea,
                        fingerprintChanged,
                    });
                    // If we lost the canvas or never had one, drive re-acquisition.
                    if (!attached || healthRef.current.status === 'lost' || healthRef.current.status === 'promoting') {
                        checkForCanvas();
                    }
                };

                const initialTimeout = setTimeout(checkForCanvas, 500);
                // Fast poll until first promote; continues as recovery when lost.
                const retryInterval = setInterval(checkForCanvas, STABILITY_POLL_INTERVAL_MS);
                // After the cold-start window, drop to a slower poll but never stop
                // (Google may replace the canvas node mid-session).
                let steadyInterval: ReturnType<typeof setInterval> | null = null;
                const switchToSteady = setTimeout(() => {
                    clearInterval(retryInterval);
                    steadyInterval = setInterval(selfCheck, 2000);
                }, 6000);

                const canvasTimeout = setTimeout(() => {
                    if (!activeCanvasRef.current) {
                        const found = panoRef.current
                            ? Array.from(panoRef.current.getElementsByTagName('canvas'))
                                  .map((c) => `${c.width}×${c.height}`)
                                  .join(', ') || 'none'
                            : 'pano div missing';
                        const sawCandidates = everSawCandidateRef.current;
                        const msg = sawCandidates
                            ? `Canvas detection timed out waiting for stable imagery (saw candidates: ${found}). The panorama may be slow to load or unavailable.`
                            : `Canvas detection timed out (found: ${found}) — Street View may be unavailable at this location.`;
                        console.error('[StreetView]', msg);
                        onStatusChange?.('canvas-timeout');
                        onError?.(msg);
                        emitHealth({
                            type: 'timeout',
                            sawCandidates,
                            detail: msg,
                        });
                    }
                }, 6500);

                observer = new MutationObserver(() => {
                    checkForCanvas();
                });
                observer.observe(panoRef.current, { childList: true, subtree: true });

                const suppressGmErr = () => {
                    if (!panoRef.current) return;
                    panoRef.current.querySelectorAll(
                        '[class*="gm-err"], .gm-err-container, [aria-label*="Google Maps" i], [aria-label*="This page can\'t load" i]'
                    ).forEach((el) => el.remove());
                };
                suppressGmErr();
                const errObserver = new MutationObserver(suppressGmErr);
                errObserver.observe(panoRef.current, { childList: true, subtree: true });

                // Re-acquire after tab focus / visibility return (Maps often rebuilds WebGL).
                const onVisibilityOrFocus = () => {
                    if (document.visibilityState === 'hidden') return;
                    checkForCanvas();
                };
                document.addEventListener('visibilitychange', onVisibilityOrFocus);
                window.addEventListener('focus', onVisibilityOrFocus);

                return () => {
                    clearTimeout(initialTimeout);
                    clearInterval(retryInterval);
                    clearTimeout(switchToSteady);
                    if (steadyInterval) clearInterval(steadyInterval);
                    clearTimeout(canvasTimeout);
                    errObserver.disconnect();
                    document.removeEventListener('visibilitychange', onVisibilityOrFocus);
                    window.removeEventListener('focus', onVisibilityOrFocus);
                    panoInstanceRef.current = null;
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
                emitHealth({
                    type: 'auth_blocked',
                    detail: 'Failed to load Google Maps API. Please check your API key and network connection.',
                });
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
    }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="streetview-scraper" style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div
                ref={panoRef}
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    opacity: SCRAPER_CONTAINER_INVARIANTS.opacity,
                    pointerEvents: SCRAPER_CONTAINER_INVARIANTS.pointerEvents as React.CSSProperties['pointerEvents'],
                    backgroundColor: '#000',
                }}
            />
        </div>
    );
};

export default StreetView;
