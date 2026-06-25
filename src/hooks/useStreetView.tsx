import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { findBestLink } from '../utils/navigation';
import { StreetViewRenderer } from '../renderer/RendererBackend';
import {
  getCanvasFingerprint,
  STABILITY_MAX_TICKS,
  STABILITY_MIN_DELAY_TICKS,
  STABILITY_POLL_INTERVAL_MS,
  STABILITY_REQUIRED_STABLE_TICKS,
} from '../utils/panoramaStability';
import { installStreetViewProbe, streetViewProbe } from '../utils/streetViewProbe';

// Types
export interface StreetViewState {
  // Core panorama reference
  panorama: google.maps.StreetViewPanorama | null;
  canvas: HTMLCanvasElement | null;
  
  // View state
  heading: number;
  pitch: number;
  zoom: number;
  
  // Location
  position: google.maps.LatLng | null;
  locationName: string;
  
  // Renderer reference for GPU transition control
  renderer: StreetViewRenderer | null;
  setRenderer: (renderer: StreetViewRenderer | null) => void;
  
  // Actions
  setPanorama: (panorama: google.maps.StreetViewPanorama | null) => void;
  setCanvas: (canvas: HTMLCanvasElement | null) => void;
  setHeading: (heading: number | ((prev: number) => number)) => void;
  setPitch: (pitch: number | ((prev: number) => number)) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setPosition: (position: google.maps.LatLng | null, locationName?: string) => void;
  
  // Navigation
  advance: (direction: 'forward' | 'backward' | 'left' | 'right', currentHeading?: number) => void;
  teleport: (lat: number, lng: number, targetHeading?: number, targetPitch?: number) => void;
  
  // Transition state
  isTransitioning: boolean;
  setIsTransitioning: (transitioning: boolean) => void;
  
  // Panorama readiness — true when the new hidden canvas is stable and fully loaded
  isPanoramaReady: boolean;
  /** True while advancing: outgoing frame is held; live GMaps canvas must not be sampled. */
  isPanoramaUpdatePaused: boolean;
  readyPromise: () => Promise<void>;
  
  // Cached snapshot of the outgoing panorama (WebGL fallback / diagnostics)
  transitionSource: HTMLCanvasElement | null;
}

const StreetViewContext = createContext<StreetViewState | null>(null);

export const useStreetView = () => {
  const context = useContext(StreetViewContext);
  if (!context) {
    throw new Error('useStreetView must be used within StreetViewProvider');
  }
  return context;
};

interface StreetViewProviderProps {
  children: React.ReactNode;
  initialPosition?: { lat: number; lng: number };
  initialHeading?: number;
  initialPitch?: number;
}

export const StreetViewProvider: React.FC<StreetViewProviderProps> = ({
  children,
  initialPosition = { lat: 37.86926, lng: -122.254811 },
  initialHeading = 34,
  initialPitch = 10,
}) => {
  // Core refs and state
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [panorama, setPanoramaState] = useState<google.maps.StreetViewPanorama | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Renderer reference for GPU transitions
  const [renderer, setRendererState] = useState<StreetViewRenderer | null>(null);
  const rendererRef = useRef<StreetViewRenderer | null>(null);
  
  // View state
  const [heading, setHeadingState] = useState(initialHeading);
  const [pitch, setPitchState] = useState(initialPitch);
  const [zoom, setZoomState] = useState(1.0);
  
  // Location state
  const [position, setPositionState] = useState<google.maps.LatLng | null>(null);
  const [locationName, setLocationName] = useState('');
  
  // Transition state
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPanoramaReady, setIsPanoramaReady] = useState(true);
  const isPanoramaReadyRef = useRef(true);
  const isPanoramaUpdatePausedRef = useRef(false);
  const readyPromiseRef = useRef<Set<() => void>>(new Set());
  const [transitionSource, setTransitionSource] = useState<HTMLCanvasElement | null>(null);
  
  // Transition animation RAF ref (release crossfade only)
  const transitionRafRef = useRef<number | null>(null);

  // Expose window.__STREETVIEW_PROBE__ once for the lifetime of the app.
  useEffect(() => {
    installStreetViewProbe();
  }, []);

  // Keep refs in sync with state for listeners / RAF loops
  useEffect(() => { canvasRef.current = canvas; }, [canvas]);
  useEffect(() => { isPanoramaReadyRef.current = isPanoramaReady; }, [isPanoramaReady]);
  useEffect(() => {
    isPanoramaUpdatePausedRef.current = isTransitioning && !isPanoramaReady;
  }, [isTransitioning, isPanoramaReady]);
  
  // Sync heading/pitch to Google Maps — skip while hold is active so look-around
  // is driven only by WebGPU UV delta on the frozen snapshot (not loading pano POV).
  useEffect(() => {
    const pano = panoramaRef.current;
    if (!pano || isPanoramaUpdatePausedRef.current) return;
    pano.setPov({ heading, pitch });
  }, [heading, pitch, isTransitioning, isPanoramaReady]);
  
  // Sync zoom to Google Maps panorama (also paused during hold)
  useEffect(() => {
    const pano = panoramaRef.current;
    if (!pano || isPanoramaUpdatePausedRef.current) return;
    const panoZoom = Math.floor(zoom);
    if (panoZoom !== pano.getZoom()) {
      pano.setZoom(panoZoom);
    }
  }, [zoom, isTransitioning, isPanoramaReady]);

  // Resolve any pending ready promises when panorama becomes ready
  useEffect(() => {
    if (isPanoramaReady) {
      readyPromiseRef.current.forEach(resolve => resolve());
      readyPromiseRef.current.clear();
    }
  }, [isPanoramaReady]);

  const setHeading = useCallback((value: number | ((prev: number) => number)) => {
    setHeadingState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      // Normalize to 0-360
      return ((newValue % 360) + 360) % 360;
    });
  }, []);
  
  const setPitch = useCallback((value: number | ((prev: number) => number)) => {
    setPitchState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      // Clamp to -90 to 90
      return Math.max(-90, Math.min(90, newValue));
    });
  }, []);
  
  const setZoom = useCallback((value: number | ((prev: number) => number)) => {
    setZoomState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      // Clamp to 1-3
      return Math.max(1.0, Math.min(3.0, newValue));
    });
  }, []);
  
  const setPanorama = useCallback((pano: google.maps.StreetViewPanorama | null) => {
    panoramaRef.current = pano;
    setPanoramaState(pano);
  }, []);
  
  const setPosition = useCallback((pos: google.maps.LatLng | null, name?: string) => {
    setPositionState(pos);
    if (name) setLocationName(name);
  }, []);
  
  const setRenderer = useCallback((r: StreetViewRenderer | null) => {
    rendererRef.current = r;
    setRendererState(r);
  }, []);
  
  const readyPromise = useCallback(() => {
    if (isPanoramaReadyRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      readyPromiseRef.current.add(resolve);
    });
  }, []);
  
  // === HOLD-PAUSE TRANSITION ===
  // Shared by advance() and teleport(): snapshot the outgoing frame, arm the
  // GPU hold (look-around stays enabled on the frozen snapshot), and put the
  // provider into the paused state until the new panorama canvas stabilizes.
  // Both call sites end up firing the same panorama's `pano_changed` event
  // (via setPano or setPosition), so the single stability watcher below
  // handles the release for either path identically.
  const armHold = useCallback(() => {
    const renderer = rendererRef.current;
    // Snapshot uses view heading/pitch (what is on screen), not car body heading.
    renderer?.beginHoldTransition(heading, pitch);
    streetViewProbe.holdArmed();

    const currentCanvas = canvasRef.current;
    if (currentCanvas && currentCanvas.width > 0 && currentCanvas.height > 0) {
      try {
        const snap = document.createElement('canvas');
        snap.width = currentCanvas.width;
        snap.height = currentCanvas.height;
        const ctx = snap.getContext('2d');
        if (ctx) {
          ctx.drawImage(currentCanvas, 0, 0);
          setTransitionSource(snap);
        }
      } catch (e) {
        console.warn('[StreetView] Failed to snapshot outgoing canvas:', e);
      }
    }

    setIsPanoramaReady(false);
    setIsTransitioning(true);

    if (transitionRafRef.current !== null) {
      cancelAnimationFrame(transitionRafRef.current);
      transitionRafRef.current = null;
    }
  }, [heading, pitch]);

  // Navigation function with GPU transition
  const advance = useCallback((
    direction: 'forward' | 'backward' | 'left' | 'right',
    currentHeading?: number
  ) => {
    const pano = panoramaRef.current;
    if (!pano || isTransitioning) return;

    const links = pano.getLinks();
    if (!links) return;

    const useHeading = currentHeading ?? heading;

    const bestLink = findBestLink(
      links.filter((link): link is google.maps.StreetViewLink => link !== null),
      useHeading,
      direction
    );

    if (bestLink && bestLink.pano) {
      armHold();
      pano.setPano(bestLink.pano);
    }
  }, [heading, isTransitioning, armHold]);

  // Teleport function — same hold-pause treatment as advance() so MiniMap
  // clicks, autopilot waypoints, and globe-teleport never flash the blurry
  // loading tiles of the destination location.
  // Note: no current caller passes targetHeading/targetPitch (it's applied
  // immediately, as before). If a future caller starts using it, revisit —
  // changing heading/pitch while a hold is armed feeds a large delta into
  // the look-around UV-shift math and will visibly swing the frozen frame.
  const teleport = useCallback((
    lat: number,
    lng: number,
    targetHeading?: number,
    targetPitch?: number
  ) => {
    const pano = panoramaRef.current;
    if (!pano || isTransitioning) return;

    armHold();
    pano.setPosition({ lat, lng });

    if (targetHeading !== undefined) {
      setHeading(targetHeading);
    }
    if (targetPitch !== undefined) {
      setPitch(targetPitch);
    }
  }, [isTransitioning, armHold, setHeading, setPitch]);
  
  // Listen for panorama changes
  useEffect(() => {
    const pano = panoramaRef.current;
    if (!pano) return;
    
    let stabilityInterval: ReturnType<typeof setInterval> | null = null;
    let lastHandledPanoId = pano.getPano() || '';
    
    const handlePanoChanged = () => {
      const panoId = pano.getPano() || '';
      // Google sometimes fires spurious pano_changed events (e.g. when COEP blocks
      // auxiliary Maps requests). Ignore repeats for the same pano once we're ready.
      if (panoId && panoId === lastHandledPanoId && isPanoramaReadyRef.current) {
        return;
      }
      lastHandledPanoId = panoId;
      console.log('[StreetView] Panorama changed event fired', panoId ? `(${panoId})` : '');
      const loc = pano.getLocation();
      if (loc) {
        const desc = loc.description || loc.shortDescription || 'Unknown Location';
        setLocationName(desc);
      }

      const pos = pano.getPosition();
      if (pos) {
        setPositionState(pos);
      }

      // --- Canvas stability gate ---
      // Replace the old fixed 700 ms timer with a real load/stability check.
      if (stabilityInterval) {
        clearInterval(stabilityInterval);
        stabilityInterval = null;
      }

      let stableCount = 0;
      let lastFingerprint = '';
      let tickCount = 0;

      stabilityInterval = setInterval(() => {
        const c = canvasRef.current;
        tickCount++;

        // Check panorama status — if Google reports the imagery is unavailable,
        // don't hang waiting for a stable canvas.
        const status = (pano as any).getStatus?.();
        if (status && status !== 'OK') {
          clearInterval(stabilityInterval!);
          stabilityInterval = null;
          console.warn('[StreetView] Panorama status not OK, forcing ready:', status);
          streetViewProbe.firstStable();
          setIsPanoramaReady(true);
          return;
        }

        if (!c || c.width < 256 || c.height < 256) {
          stableCount = 0;
          if (tickCount >= STABILITY_MAX_TICKS) {
            clearInterval(stabilityInterval!);
            stabilityInterval = null;
            console.log('[StreetView] Stability fallback (no canvas)');
            streetViewProbe.firstStable();
            setIsPanoramaReady(true);
          }
          return;
        }

        const fingerprint = getCanvasFingerprint(c);
        if (fingerprint && fingerprint === lastFingerprint) {
          stableCount++;
          // Require both sufficient stability AND minimum delay to avoid
          // revealing the low-res preview tile before 720 imagery decodes.
          if (stableCount >= STABILITY_REQUIRED_STABLE_TICKS && tickCount >= STABILITY_MIN_DELAY_TICKS) {
            clearInterval(stabilityInterval!);
            stabilityInterval = null;
            console.log('[StreetView] Canvas stable, panorama ready');
            streetViewProbe.firstStable();
            setIsPanoramaReady(true);
            return;
          }
        } else {
          stableCount = 0;
          lastFingerprint = fingerprint;
        }

        if (tickCount >= STABILITY_MAX_TICKS) {
          clearInterval(stabilityInterval!);
          stabilityInterval = null;
          console.log('[StreetView] Stability fallback (timeout)');
          streetViewProbe.firstStable();
          setIsPanoramaReady(true);
        }
      }, STABILITY_POLL_INTERVAL_MS);
    };
    
    const listener = pano.addListener('pano_changed', handlePanoChanged);
    
    return () => {
      google.maps.event.removeListener(listener);
      if (stabilityInterval) {
        clearInterval(stabilityInterval);
      }
    };
  }, [panorama]);

  // Release crossfade once the new panorama canvas is stable
  useEffect(() => {
    if (!isTransitioning || !isPanoramaReady) return;

    const renderer = rendererRef.current;
    if (!renderer) {
      setIsTransitioning(false);
      setTransitionSource(null);
      streetViewProbe.released();
      return;
    }

    renderer.endHoldTransition();

    const RELEASE_DURATION = 250;
    const startTime = performance.now();

    const animateRelease = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1.0, elapsed / RELEASE_DURATION);
      renderer.setTransitionProgress(progress);

      if (progress < 1.0) {
        transitionRafRef.current = requestAnimationFrame(animateRelease);
      } else {
        transitionRafRef.current = null;
        renderer.setTransitionProgress(0.0);
        renderer.endHoldTransition();
        setIsTransitioning(false);
        setTransitionSource(null);
        console.log('[StreetView] Transition pause complete, ready for next advance');
        streetViewProbe.released();
      }
    };

    if (transitionRafRef.current !== null) {
      cancelAnimationFrame(transitionRafRef.current);
    }
    transitionRafRef.current = requestAnimationFrame(animateRelease);

    return () => {
      if (transitionRafRef.current !== null) {
        cancelAnimationFrame(transitionRafRef.current);
        transitionRafRef.current = null;
      }
    };
  }, [isTransitioning, isPanoramaReady]);
  
  // Cleanup transition RAF on unmount
  useEffect(() => {
    return () => {
      if (transitionRafRef.current !== null) {
        cancelAnimationFrame(transitionRafRef.current);
      }
      readyPromiseRef.current.clear();
    };
  }, []);
  
  const value: StreetViewState = {
    panorama,
    canvas,
    heading,
    pitch,
    zoom,
    position,
    locationName,
    renderer,
    setRenderer,
    setPanorama,
    setCanvas,
    setHeading,
    setPitch,
    setZoom,
    setPosition,
    advance,
    teleport,
    isTransitioning,
    setIsTransitioning,
    isPanoramaReady,
    isPanoramaUpdatePaused: isTransitioning && !isPanoramaReady,
    readyPromise,
    transitionSource,
  };
  
  return (
    <StreetViewContext.Provider value={value}>
      {children}
    </StreetViewContext.Provider>
  );
};

export default StreetViewContext;
