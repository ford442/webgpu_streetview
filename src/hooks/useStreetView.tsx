import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { findBestLink } from '../utils/navigation';
import { StreetViewRenderer } from '../renderer/RendererBackend';
import {
  advancePanoramaStabilityTick,
  createPanoramaStabilityState,
  getCanvasFingerprint,
  STABILITY_POLL_INTERVAL_MS,
} from '../utils/panoramaStability';
import { povStore } from '../state/povStore';
import { installStreetViewProbe, streetViewProbe } from '../utils/streetViewProbe';
import { HISTORICAL_WIPE_DURATION_MS, wipeProgressAt, type HistoricalReveal } from '../renderer/historicalWipe';

// Types
export interface TeleportToPanoOptions {
  reveal?: HistoricalReveal;
}

export interface StreetViewState {
  // Core panorama reference
  panorama: google.maps.StreetViewPanorama | null;
  canvas: HTMLCanvasElement | null;
  
  // View state
  
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
  /**
   * Jump straight to a known panorama id (e.g. a historical capture) with the
   * same hold-pause treatment. `reveal` picks how the held frame gives way once
   * the new panorama is stable (year chips: GPU wipe, or a cut under reduced
   * motion); omitted, it is the usual release crossfade.
   */
  teleportToPano: (panoId: string, options?: TeleportToPanoOptions) => void;
  
  // Transition state
  isTransitioning: boolean;
  setIsTransitioning: (transitioning: boolean) => void;
  
  // Panorama readiness — true when the new hidden canvas is stable and fully loaded
  isPanoramaReady: boolean;
  /** True while advancing: outgoing frame is held; live GMaps canvas must not be sampled. */
  isPanoramaUpdatePaused: boolean;
  /** Resolves when the current panorama canvas is stable (hold may still be releasing). */
  readyPromise: () => Promise<void>;
  /** Resolves when navigation is idle — stable panorama and release crossfade complete. */
  navigationIdlePromise: () => Promise<void>;
  
  // Cached snapshot of the outgoing panorama (diagnostics / hold-pause CPU path)
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
  initialPosition: _initialPosition = { lat: 37.86926, lng: -122.254811 },
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
  
  // View POV lives in the external povStore (src/state/povStore.ts), NOT in
  // React state: heading/pitch change on every pointermove and must not
  // re-render every context consumer. Seed it once, before children render.
  useState(() => {
    povStore.reset({ heading: initialHeading, pitch: initialPitch, zoom: 1 });
  });
  
  // Location state
  const [position, setPositionState] = useState<google.maps.LatLng | null>(null);
  const [locationName, setLocationName] = useState('');
  
  // Transition state
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPanoramaReady, setIsPanoramaReady] = useState(true);
  const isPanoramaReadyRef = useRef(true);
  const isTransitioningRef = useRef(false);
  const isPanoramaUpdatePausedRef = useRef(false);
  const holdBaselineFingerprintRef = useRef('');
  const readyPromiseRef = useRef<Set<() => void>>(new Set());
  const navigationIdlePromiseRef = useRef<Set<() => void>>(new Set());
  const [transitionSource, setTransitionSource] = useState<HTMLCanvasElement | null>(null);
  
  // Transition animation RAF ref (release crossfade only)
  const transitionRafRef = useRef<number | null>(null);
  /** How the next hold release reveals the new panorama; null = crossfade. */
  const pendingRevealRef = useRef<HistoricalReveal | null>(null);

  // Expose window.__STREETVIEW_PROBE__ once for the lifetime of the app.
  useEffect(() => {
    installStreetViewProbe();
  }, []);

  // Keep refs in sync with state for listeners / RAF loops
  useEffect(() => { canvasRef.current = canvas; }, [canvas]);
  useEffect(() => { isPanoramaReadyRef.current = isPanoramaReady; }, [isPanoramaReady]);
  useEffect(() => { isTransitioningRef.current = isTransitioning; }, [isTransitioning]);
  useEffect(() => {
    isPanoramaUpdatePausedRef.current = isTransitioning && !isPanoramaReady;
  }, [isTransitioning, isPanoramaReady]);
  
  // Sync heading/pitch/zoom to Google Maps — skipped while hold is active so
  // look-around is driven only by WebGPU UV delta on the frozen snapshot (not
  // loading pano POV). Runs imperatively off the store and again whenever
  // the hold state changes.
  const syncPovToPano = useCallback(() => {
    const pano = panoramaRef.current;
    if (!pano || isPanoramaUpdatePausedRef.current) return;
    const { heading, pitch, zoom } = povStore.get();
    pano.setPov({ heading, pitch });
    const panoZoom = Math.floor(zoom);
    if (panoZoom !== pano.getZoom()) {
      pano.setZoom(panoZoom);
    }
  }, []);

  useEffect(() => {
    syncPovToPano();
  }, [syncPovToPano, panorama, isTransitioning, isPanoramaReady]);

  // The store is written by input handlers (mouse/keys at ~frame rate), so a direct
  // call per change is already about one Maps write per frame.
  useEffect(() => povStore.subscribe(syncPovToPano), [syncPovToPano]);

  // Resolve any pending ready promises when panorama becomes ready
  useEffect(() => {
    if (isPanoramaReady) {
      readyPromiseRef.current.forEach(resolve => resolve());
      readyPromiseRef.current.clear();
    }
  }, [isPanoramaReady]);

  const resolveNavigationIdleWaiters = useCallback(() => {
    if (!isPanoramaReadyRef.current || isTransitioningRef.current) return;
    navigationIdlePromiseRef.current.forEach(resolve => resolve());
    navigationIdlePromiseRef.current.clear();
  }, []);

  // Resolve navigation-idle waiters once the release crossfade finishes.
  useEffect(() => {
    resolveNavigationIdleWaiters();
  }, [isPanoramaReady, isTransitioning, resolveNavigationIdleWaiters]);

  // Stable writers into the store (heading wraps to 0–360, pitch clamps ±90, zoom 1–3).
  const setHeading = povStore.setHeading;
  const setPitch = povStore.setPitch;
  const setZoom = povStore.setZoom;
  
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

  const navigationIdlePromise = useCallback(() => {
    if (isPanoramaReadyRef.current && !isTransitioningRef.current) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      navigationIdlePromiseRef.current.add(resolve);
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
    const currentCanvas = canvasRef.current;

    // Snapshot uses view heading/pitch (what is on screen), not car body heading.
    const pov = povStore.get();
    renderer?.beginHoldTransition(pov.heading, pov.pitch, currentCanvas ?? undefined);
    streetViewProbe.holdArmed();
    pendingRevealRef.current = null;

    holdBaselineFingerprintRef.current = currentCanvas
      ? getCanvasFingerprint(currentCanvas)
      : '';

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

    // Sync refs immediately so RAF / pano_changed listeners see the hold before
    // React re-renders — avoids a one-frame live upload leak.
    isPanoramaReadyRef.current = false;
    isTransitioningRef.current = true;
    isPanoramaUpdatePausedRef.current = true;
    setIsPanoramaReady(false);
    setIsTransitioning(true);

    if (transitionRafRef.current !== null) {
      cancelAnimationFrame(transitionRafRef.current);
      transitionRafRef.current = null;
    }
  }, []);

  // Navigation function with GPU transition
  const advance = useCallback((
    direction: 'forward' | 'backward' | 'left' | 'right',
    currentHeading?: number
  ) => {
    const pano = panoramaRef.current;
    if (!pano || isTransitioningRef.current) return;

    // Cruise / WASD hop: Street View link graph only — never Geocoder.
    const links = pano.getLinks();
    if (!links) return;

    const useHeading = currentHeading ?? povStore.get().heading;

    const bestLink = findBestLink(
      links.filter((link): link is google.maps.StreetViewLink => link !== null),
      useHeading,
      direction
    );

    if (bestLink && bestLink.pano) {
      armHold();
      pano.setPano(bestLink.pano);
    }
  }, [armHold]);

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
    if (!pano || isTransitioningRef.current) return;

    armHold();
    pano.setPosition({ lat, lng });

    if (targetHeading !== undefined) {
      setHeading(targetHeading);
    }
    if (targetPitch !== undefined) {
      setPitch(targetPitch);
    }
  }, [isTransitioning, armHold, setHeading, setPitch]);

  // Jump directly to a known panorama id (historical capture, saved bookmark
  // pano, etc). Heading/pitch are left untouched so a POV comparison stays
  // apples-to-apples across dates. Same hold-pause treatment as advance/teleport.
  const teleportToPano = useCallback((panoId: string, options?: TeleportToPanoOptions) => {
    const pano = panoramaRef.current;
    if (!pano || isTransitioningRef.current || !panoId) return;

    armHold();
    pendingRevealRef.current = options?.reveal ?? null;
    pano.setPano(panoId);
  }, [isTransitioning, armHold]);

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

      // Only gate hold-release while a hop is in progress. Outside advance() /
      // teleport() the live canvas feed should stay connected.
      if (!isTransitioningRef.current) {
        return;
      }

      // --- Canvas stability gate ---
      if (stabilityInterval) {
        clearInterval(stabilityInterval);
        stabilityInterval = null;
      }

      let stabilityState = createPanoramaStabilityState(holdBaselineFingerprintRef.current);

      stabilityInterval = setInterval(() => {
        const c = canvasRef.current;
        const status = (pano as { getStatus?: () => string }).getStatus?.();
        const fingerprint = c ? getCanvasFingerprint(c) : '';

        const { outcome, state } = advancePanoramaStabilityTick(stabilityState, {
          fingerprint,
          holdBaselineFingerprint: holdBaselineFingerprintRef.current,
          panoStatus: status,
          hasCanvas: !!(c && c.width >= 256 && c.height >= 256),
        });
        stabilityState = state;

        if (outcome.type === 'ready') {
          clearInterval(stabilityInterval!);
          stabilityInterval = null;
          console.log('[StreetView] Canvas stable, panorama ready');
          streetViewProbe.firstStable();
          isPanoramaReadyRef.current = true;
          isPanoramaUpdatePausedRef.current = false;
          setIsPanoramaReady(true);
          return;
        }

        if (outcome.type === 'force-ready') {
          clearInterval(stabilityInterval!);
          stabilityInterval = null;
          const reason =
            outcome.reason === 'status-error'
              ? `Panorama status not OK, forcing ready: ${status}`
              : outcome.reason === 'no-canvas-timeout'
                ? 'Stability fallback (no canvas)'
                : 'Stability fallback (timeout)';
          if (outcome.reason === 'status-error') {
            console.warn('[StreetView]', reason);
          } else {
            console.log('[StreetView]', reason);
          }
          streetViewProbe.firstStable();
          isPanoramaReadyRef.current = true;
          isPanoramaUpdatePausedRef.current = false;
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
      isTransitioningRef.current = false;
      isPanoramaReadyRef.current = true;
      isPanoramaUpdatePausedRef.current = false;
      holdBaselineFingerprintRef.current = '';
      setIsTransitioning(false);
      setTransitionSource(null);
      streetViewProbe.released();
      return;
    }

    // End hold so the release (crossfade or year-chip wipe) can show the
    // now-stable live panorama against the GPU snapshot.
    renderer.endHoldTransition();

    const reveal = pendingRevealRef.current;
    pendingRevealRef.current = null;

    const finishRelease = () => {
      transitionRafRef.current = null;
      renderer.setTransitionProgress(0.0);
      renderer.endHistoricalWipe?.();
      isTransitioningRef.current = false;
      isPanoramaReadyRef.current = true;
      isPanoramaUpdatePausedRef.current = false;
      holdBaselineFingerprintRef.current = '';
      setIsTransitioning(false);
      setTransitionSource(null);
      console.log('[StreetView] Transition pause complete, ready for next advance');
      streetViewProbe.released();
    };

    if (transitionRafRef.current !== null) {
      cancelAnimationFrame(transitionRafRef.current);
      transitionRafRef.current = null;
    }

    // Reduced motion: an instant cut — no crossfade, no wipe shader.
    if (reveal?.kind === 'cut') {
      finishRelease();
      return;
    }

    // Year-chip wipe, when the renderer can run it from its hold snapshot;
    // otherwise (WebGL, no pipeline, no snapshot) the usual crossfade.
    const wiping = reveal?.kind === 'wipe'
      && renderer.beginHistoricalWipe?.(reveal.direction) === true;

    const RELEASE_DURATION = 250;
    const startTime = performance.now();

    const animateRelease = () => {
      const elapsed = performance.now() - startTime;
      let progress: number;
      if (wiping) {
        progress = Math.min(1.0, elapsed / HISTORICAL_WIPE_DURATION_MS);
        renderer.setHistoricalWipeProgress?.(wipeProgressAt(elapsed, HISTORICAL_WIPE_DURATION_MS));
      } else {
        progress = Math.min(1.0, elapsed / RELEASE_DURATION);
        renderer.setTransitionProgress(progress);
      }

      if (progress < 1.0) {
        transitionRafRef.current = requestAnimationFrame(animateRelease);
      } else {
        finishRelease();
      }
    };

    transitionRafRef.current = requestAnimationFrame(animateRelease);

    return () => {
      if (transitionRafRef.current !== null) {
        cancelAnimationFrame(transitionRafRef.current);
        transitionRafRef.current = null;
        renderer.endHistoricalWipe?.();
      }
    };
  }, [isTransitioning, isPanoramaReady]);
  
  // Cleanup transition RAF on unmount
  useEffect(() => {
    const readyPromiseTracker = readyPromiseRef.current;
    const navigationIdleTracker = navigationIdlePromiseRef.current;
    return () => {
      if (transitionRafRef.current !== null) {
        cancelAnimationFrame(transitionRafRef.current);
      }
      readyPromiseTracker.clear();
      navigationIdleTracker.clear();
    };
  }, []);
  
  // Memoized: consumers re-render only when something they can observe changed.
  // (POV is NOT part of this value — see povStore.)
  const value = useMemo<StreetViewState>(() => ({
    panorama,
    canvas,
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
    teleportToPano,
    isTransitioning,
    setIsTransitioning,
    isPanoramaReady,
    isPanoramaUpdatePaused: isTransitioning && !isPanoramaReady,
    readyPromise,
    navigationIdlePromise,
    transitionSource,
  }), [
    panorama, canvas, position, locationName, renderer, setRenderer, setPanorama,
    setHeading, setPitch, setZoom, setPosition, advance, teleport, teleportToPano,
    isTransitioning, isPanoramaReady, readyPromise, navigationIdlePromise, transitionSource,
  ]);
  
  return (
    <StreetViewContext.Provider value={value}>
      {children}
    </StreetViewContext.Provider>
  );
};

export default StreetViewContext;
