import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { initCarMode, toggleCarMode, disposeCarMode, CarModeState } from '../car';

// Types
export type ViewMode = 'freelook' | 'car';
export type ControlMode = 'freeLook' | 'uiMouse' | 'carSteer';
export type HeadCoupling = 'rigid' | 'free';

export interface ViewModeState {
  // Main mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  
  // Car control mode
  controlMode: ControlMode;
  setControlMode: (mode: ControlMode) => void;
  toggleControlMode: () => void;
  
  // Head coupling (how head moves with car steering)
  headCoupling: HeadCoupling;
  setHeadCoupling: (coupling: HeadCoupling) => void;
  
  // Temporary mode switch (steering wheel click)
  isTempSteerMode: boolean;
  startTempSteerMode: () => void;
  endTempSteerMode: () => void;
  
  // Car body heading (separate from head-look heading in useStreetView)
  carHeading: number;
  setCarHeading: (heading: number | ((prev: number) => number)) => void;

  // Car mode state reference (for Three.js integration)
  carModeState: CarModeState | null;
  
  // Initialization
  initCarModeForContainer: (container: HTMLElement) => void;
  registerCarModeState: (state: CarModeState) => void;
}

const ViewModeContext = createContext<ViewModeState | null>(null);

export const useViewMode = () => {
  const context = useContext(ViewModeContext);
  if (!context) {
    throw new Error('useViewMode must be used within ViewModeProvider');
  }
  return context;
};

interface ViewModeProviderProps {
  children: React.ReactNode;
  initialMode?: ViewMode;
}

export const ViewModeProvider: React.FC<ViewModeProviderProps> = ({
  children,
  initialMode = 'freelook',
}) => {
  // Main view mode
  const [viewMode, setViewModeState] = useState<ViewMode>(initialMode);
  const [prevViewMode, setPrevViewMode] = useState<ViewMode | null>(null);
  
  // Car control sub-mode
  const [controlMode, setControlMode] = useState<ControlMode>('freeLook');
  const previousControlModeRef = useRef<ControlMode>('freeLook');
  
  // Head coupling
  const [headCoupling, setHeadCoupling] = useState<HeadCoupling>('free');
  
  // Temporary steering mode (steering wheel click)
  const [isTempSteerMode, setIsTempSteerMode] = useState(false);

  // Car body heading (independent of head-look heading)
  const [carHeading, setCarHeadingState] = useState(34);
  const setCarHeading = useCallback((value: number | ((prev: number) => number)) => {
    setCarHeadingState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      return ((next % 360) + 360) % 360;
    });
  }, []);

  // Car mode state (Three.js)
  const carModeStateRef = useRef<CarModeState | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  
  // Auto-set head coupling based on control mode
  useEffect(() => {
    if (controlMode === 'carSteer') {
      setHeadCoupling('rigid');
    } else {
      setHeadCoupling('free');
    }
  }, [controlMode]);
  
  // Handle view mode switching with cleanup
  const setViewMode = useCallback((mode: ViewMode) => {
    if (mode === viewMode) return;
    
    setPrevViewMode(viewMode);
    setViewModeState(mode);
  }, [viewMode]);
  
  const toggleViewMode = useCallback(() => {
    setViewMode(viewMode === 'freelook' ? 'car' : 'freelook');
  }, [viewMode, setViewMode]);
  
  // Initialize car mode when container is provided
  const initCarModeForContainer = useCallback((container: HTMLElement) => {
    if (!carModeStateRef.current && container) {
      containerRef.current = container;
      try {
        carModeStateRef.current = initCarMode(container);
      } catch (err) {
        console.error('[ViewModeProvider] Failed to initialize car mode:', err);
      }
    }
  }, []);

  // Register an externally-created car mode state with the provider
  const registerCarModeState = useCallback((state: CarModeState) => {
    carModeStateRef.current = state;
    containerRef.current = state.interior.canvas?.parentElement || null;
  }, []);
  
  // Handle mode switching side effects
  useEffect(() => {
    if (prevViewMode === viewMode) return;
    
    console.log(`[ViewMode] Switching: ${prevViewMode} → ${viewMode}`);
    
    // Cleanup previous mode
    if (prevViewMode === 'car') {
      toggleCarMode(false);
    }
    
    // Initialize new mode
    if (viewMode === 'car') {
      if (carModeStateRef.current && containerRef.current) {
        toggleCarMode(true);
        // Reset car control mode to default when entering car mode
        setControlMode('freeLook');
        previousControlModeRef.current = 'freeLook';
      }
    }
  }, [viewMode, prevViewMode]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (carModeStateRef.current) {
        disposeCarMode();
        carModeStateRef.current = null;
      }
    };
  }, []);
  
  // Control mode switching
  const setControlModeWithTracking = useCallback((mode: ControlMode) => {
    previousControlModeRef.current = controlMode;
    setControlMode(mode);
  }, [controlMode]);
  
  const toggleControlMode = useCallback(() => {
    setControlMode(prev => {
      const next = prev === 'freeLook' ? 'uiMouse' : prev === 'uiMouse' ? 'carSteer' : 'freeLook';
      previousControlModeRef.current = prev;
      return next;
    });
  }, []);
  
  // Temporary steering mode (steering wheel click)
  const startTempSteerMode = useCallback(() => {
    if (controlMode !== 'carSteer') {
      previousControlModeRef.current = controlMode;
      setIsTempSteerMode(true);
      setControlMode('carSteer');
      setHeadCoupling('rigid');
    }
  }, [controlMode]);
  
  const endTempSteerMode = useCallback(() => {
    if (isTempSteerMode) {
      const prevMode = previousControlModeRef.current;
      setControlMode(prevMode);
      setHeadCoupling(prevMode === 'carSteer' ? 'rigid' : 'free');
      setIsTempSteerMode(false);
    }
  }, [isTempSteerMode]);
  
  const value: ViewModeState = {
    viewMode,
    setViewMode,
    toggleViewMode,
    controlMode,
    setControlMode: setControlModeWithTracking,
    toggleControlMode,
    headCoupling,
    setHeadCoupling,
    isTempSteerMode,
    startTempSteerMode,
    endTempSteerMode,
    carHeading,
    setCarHeading,
    carModeState: carModeStateRef.current,
    initCarModeForContainer,
    registerCarModeState,
  };
  
  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  );
};

export default ViewModeContext;
