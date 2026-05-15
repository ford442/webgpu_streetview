import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { findBestLink } from '../utils/navigation';
import { Renderer } from '../renderer/Renderer';

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
  renderer: Renderer | null;
  setRenderer: (renderer: Renderer | null) => void;
  
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
  readyPromise: () => Promise<void>;
  
  // Cached snapshot of the outgoing panorama, used as render source while loading
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

let sharedOffscreenCanvas: HTMLCanvasElement | null = null;
let sharedOffscreenCtx: CanvasRenderingContext2D | null = null;

/** Lightweight pixel fingerprint to detect canvas stability */
function getCanvasFingerprint(canvas: HTMLCanvasElement): string {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 256 || h < 256) return '';
  try {
    if (!sharedOffscreenCanvas) {
      sharedOffscreenCanvas = document.createElement('canvas');
      sharedOffscreenCanvas.width = 4;
      sharedOffscreenCanvas.height = 4;
    }
    if (!sharedOffscreenCtx) {
      sharedOffscreenCtx = sharedOffscreenCanvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = sharedOffscreenCtx;
    if (!ctx) return '';

    const sx = Math.floor(w / 2 - 64);
    const sy = Math.floor(h / 2 - 64);
    ctx.drawImage(canvas, sx, sy, 128, 128, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    let hash = 0;
    let brightness = 0;
    for (let i = 0; i < d.length; i += 4) {
      hash = ((hash << 5) - hash) + d[i] + d[i + 1] + d[i + 2];
      brightness += d[i] + d[i + 1] + d[i + 2];
    }
    // Mostly black = probably still loading, but allow very dark valid frames
    // (e.g. nighttime/error screens) to pass so we don't hang forever.
    const avgBrightness = brightness / ((d.length / 4) * 3);
    if (avgBrightness < 2) return '';
    return `${w}x${h}-${hash}`;
  } catch {
    return '';
  }
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
  const [renderer, setRendererState] = useState<Renderer | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  
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
  const readyPromiseRef = useRef<Set<() => void>>(new Set());
  const [transitionSource, setTransitionSource] = useState<HTMLCanvasElement | null>(null);
  
  // Transition animation RAF ref
  const transitionRafRef = useRef<number | null>(null);
  
  // Keep refs in sync with state for listeners / RAF loops
  useEffect(() => { canvasRef.current = canvas; }, [canvas]);
  useEffect(() => { isPanoramaReadyRef.current = isPanoramaReady; }, [isPanoramaReady]);
  
  // Resolve any pending ready promises when panorama becomes ready
  useEffect(() => {
    if (isPanoramaReady) {
      readyPromiseRef.current.forEach(resolve => resolve());
      readyPromiseRef.current.clear();
    }
  }, [isPanoramaReady]);
  
  // Wrap setters to handle both values and updater functions
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
  
  const setRenderer = useCallback((r: Renderer | null) => {
    rendererRef.current = r;
    setRendererState(r);
  }, []);
  
  const readyPromise = useCallback(() => {
    if (isPanoramaReadyRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      readyPromiseRef.current.add(resolve);
    });
  }, []);
  
  // Sync heading/pitch to Google Maps panorama
  useEffect(() => {
    const pano = panoramaRef.current;
    if (pano) {
      pano.setPov({ heading, pitch });
    }
  }, [heading, pitch]);
  
  // Sync zoom to Google Maps panorama
  useEffect(() => {
    const pano = panoramaRef.current;
    if (pano) {
      const panoZoom = Math.floor(zoom);
      if (panoZoom !== pano.getZoom()) {
        pano.setZoom(panoZoom);
      }
    }
  }, [zoom]);
  
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
      // === GPU TRANSITION SEQUENCE ===
      // 1. Capture the current frame BEFORE changing panorama
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.captureCurrentFrame();
      }
      
      // Normalize the link heading to the same 0-1 range used by panX uniforms
      const movementHeading = bestLink.heading ?? useHeading;
      const movementHeadingNorm = (((movementHeading % 360) + 360) % 360) / 360;

      // Snapshot raw panorama texture with movement direction so the shader
      // can shift the old frame's UVs as the user looks around during load
      renderer?.capturePanorama?.(movementHeadingNorm);

      // 2. Create a CPU-side snapshot of the outgoing panorama so
      //    WebGPUCanvas can keep rendering it while the new one loads.
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

      // 3. Start the transition state
      setIsPanoramaReady(false);
      setIsTransitioning(true);
      
      // 4. Change to the new panorama
      pano.setPano(bestLink.pano);
      
      // 5. Animate transition progress 0→1 with a load gate.
      //    Progress is clamped while isPanoramaReady is false.
      if (transitionRafRef.current !== null) {
        cancelAnimationFrame(transitionRafRef.current);
      }
      
      const BASE_DURATION = 400; // ms
      const MAX_TRANSITION_WAIT = 3000; // ms hard ceiling
      const startTime = performance.now();
      
      const animateTransition = () => {
        const elapsed = performance.now() - startTime;
        const rawProgress = elapsed / BASE_DURATION;
        const maxProgress = isPanoramaReadyRef.current ? 1.0 : 0.85;
        const progress = Math.min(maxProgress, rawProgress);
        
        // Push progress to the renderer
        if (rendererRef.current) {
          rendererRef.current.setTransitionProgress(progress);
        }
        
        if (progress < 1.0 && elapsed < MAX_TRANSITION_WAIT) {
          transitionRafRef.current = requestAnimationFrame(animateTransition);
        } else {
          // Transition complete (or hard timeout)
          transitionRafRef.current = null;
          if (rendererRef.current) {
            rendererRef.current.setTransitionProgress(1.0);
          }
          setIsTransitioning(false);
          setTransitionSource(null);
        }
      };
      
      transitionRafRef.current = requestAnimationFrame(animateTransition);
    }
  }, [heading, isTransitioning]);
  
  // Teleport function
  const teleport = useCallback((
    lat: number,
    lng: number,
    targetHeading?: number,
    targetPitch?: number
  ) => {
    const pano = panoramaRef.current;
    if (!pano) return;
    
    pano.setPosition({ lat, lng });
    
    if (targetHeading !== undefined) {
      setHeading(targetHeading);
    }
    if (targetPitch !== undefined) {
      setPitch(targetPitch);
    }
  }, [setHeading, setPitch]);
  
  // Listen for panorama changes
  useEffect(() => {
    const pano = panoramaRef.current;
    if (!pano) return;
    
    let stabilityInterval: ReturnType<typeof setInterval> | null = null;
    
    const handlePanoChanged = () => {
      console.log('[StreetView] Panorama changed event fired');
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
      const REQUIRED_STABLE = 5; // 500 ms of stability
      const MIN_DELAY_TICKS = 4; // 400 ms minimum delay after pano_changed
      const MAX_TICKS = 15;      // 1.5 s fallback

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
          setIsPanoramaReady(true);
          return;
        }

        if (!c || c.width < 256 || c.height < 256) {
          stableCount = 0;
          if (tickCount >= MAX_TICKS) {
            clearInterval(stabilityInterval!);
            stabilityInterval = null;
            console.log('[StreetView] Stability fallback (no canvas)');
            setIsPanoramaReady(true);
          }
          return;
        }

        const fingerprint = getCanvasFingerprint(c);
        if (fingerprint && fingerprint === lastFingerprint) {
          stableCount++;
          // Require both sufficient stability AND minimum delay to avoid
          // revealing the low-res preview tile before 720 imagery decodes.
          if (stableCount >= REQUIRED_STABLE && tickCount >= MIN_DELAY_TICKS) {
            clearInterval(stabilityInterval!);
            stabilityInterval = null;
            console.log('[StreetView] Canvas stable, panorama ready');
            setIsPanoramaReady(true);
            return;
          }
        } else {
          stableCount = 0;
          lastFingerprint = fingerprint;
        }

        if (tickCount >= MAX_TICKS) {
          clearInterval(stabilityInterval!);
          stabilityInterval = null;
          console.log('[StreetView] Stability fallback (timeout)');
          setIsPanoramaReady(true);
        }
      }, 100);
    };
    
    const listener = pano.addListener('pano_changed', handlePanoChanged);
    
    return () => {
      google.maps.event.removeListener(listener);
      if (stabilityInterval) {
        clearInterval(stabilityInterval);
      }
    };
  }, [panorama]);
  
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
