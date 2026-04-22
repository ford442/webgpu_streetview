import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { findBestLink } from '../utils/navigation';
import type { Renderer } from '../renderer/Renderer';

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

  // Renderer bridge for GPU transitions
  rendererRef: React.MutableRefObject<Renderer | null>;
  setRenderer: (renderer: Renderer | null) => void;
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
  initialPosition = { lat: 39.2575004, lng: -121.021821 },
  initialHeading = 34,
  initialPitch = 10,
}) => {
  // Core refs and state
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [panorama, setPanoramaState] = useState<google.maps.StreetViewPanorama | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  
  // View state
  const [heading, setHeadingState] = useState(initialHeading);
  const [pitch, setPitchState] = useState(initialPitch);
  const [zoom, setZoomState] = useState(1.0);
  
  // Location state
  const [position, setPositionState] = useState<google.maps.LatLng | null>(null);
  const [locationName, setLocationName] = useState('');
  
  // Transition state
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Renderer bridge for GPU snapshot + transition tween
  const rendererRef = useRef<Renderer | null>(null);
  const transitionRafRef = useRef<number | null>(null);

  const setRenderer = useCallback((renderer: Renderer | null) => {
    rendererRef.current = renderer;
  }, []);

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
  
  // Navigation function
  const advance = useCallback((
    direction: 'forward' | 'backward' | 'left' | 'right',
    currentHeading?: number
  ) => {
    const pano = panoramaRef.current;
    const renderer = rendererRef.current;
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
      // 1. Snapshot current frame so the shader can blend from it
      renderer?.captureCurrentFrame?.();

      // 2. Trigger the panorama change
      setIsTransitioning(true);
      pano.setPano(bestLink.pano);

      // 3. Tween transitionProgress 0 → 1 over 500ms via RAF
      if (transitionRafRef.current) {
        cancelAnimationFrame(transitionRafRef.current);
      }

      const duration = 500;
      const startTime = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1.0, elapsed / duration);
        renderer?.setTransitionProgress?.(progress);

        if (progress < 1.0) {
          transitionRafRef.current = requestAnimationFrame(tick);
        } else {
          // Transition complete — reset for next time
          renderer?.setTransitionProgress?.(0.0);
          transitionRafRef.current = null;
        }
      };
      transitionRafRef.current = requestAnimationFrame(tick);
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
    
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    
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
      
      // Transition pause: GPU animation completes in ~450ms; 700ms gives tiles
      // time to load while remaining snappier than the old 1200ms black screen.
      if (pauseTimer) clearTimeout(pauseTimer);
      pauseTimer = setTimeout(() => {
        console.log('[StreetView] Transition pause complete, ready for next advance');
        setIsTransitioning(false);
      }, 700);
    };
    
    const listener = pano.addListener('pano_changed', handlePanoChanged);
    
    return () => {
      google.maps.event.removeListener(listener);
      if (pauseTimer) clearTimeout(pauseTimer);
    };
  }, [panorama]);
  
  const value: StreetViewState = {
    panorama,
    canvas,
    heading,
    pitch,
    zoom,
    position,
    locationName,
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
    rendererRef,
    setRenderer,
  };
  
  return (
    <StreetViewContext.Provider value={value}>
      {children}
    </StreetViewContext.Provider>
  );
};

export default StreetViewContext;
