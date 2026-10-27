import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { loadCarRuntime, type CarModeState } from '../car/carRuntimeLoader';
import { currentSearch } from '../config/flags';
import { povStore } from '../state/povStore';
import {
  INITIAL_CABIN_INPUT,
  cabinInputMode,
  transitionCabinInput,
  type CabinInputEvent,
  type CabinInputTransition,
  type ControlMode,
} from '../car/input/cabinInputMachine';

// Types
export type ViewMode = 'freelook' | 'car';
export type { ControlMode };

export interface ViewModeState {
  // Main mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  
  // Car control mode — derived from the cabin input machine
  // (`car/input/cabinInputMachine.ts`). Changes only on discrete events
  // (lock, right button, F, Tab), never per mouse move.
  controlMode: ControlMode;
  /**
   * Feed an input event to the machine. Returns the transition: its
   * pointer-lock `effect` the caller must run *inside the same event handler*
   * (`applyPointerLockEffect`), and any `steerDeg` to apply (a WebXR stick).
   */
  dispatchCabinInput: (event: CabinInputEvent) => CabinInputTransition;

  // Car body heading (separate from head-look heading in useStreetView)
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
  
  // Car control sub-mode: the machine state lives in a ref (it must be read
  // synchronously inside gesture handlers); React sees only the derived mode.
  const cabinInputRef = useRef(INITIAL_CABIN_INPUT);
  const [controlMode, setControlMode] = useState<ControlMode>(cabinInputMode(INITIAL_CABIN_INPUT));
  const dispatchCabinInput = useCallback((event: CabinInputEvent): CabinInputTransition => {
    const transition = transitionCabinInput(cabinInputRef.current, event);
    cabinInputRef.current = transition.state;
    setControlMode(cabinInputMode(transition.state));
    return transition;
  }, []);

  // Car body heading (independent of head-look heading)
  // (lives in the external povStore — it changes while steering and must not
  // re-render every ViewMode consumer; read it with povStore.get().carHeading
  // or usePovSelector). The setter is a stable store writer that wraps to 0–360.
  const setCarHeading = povStore.setCarHeading;

  // Car mode state (Three.js)
  const carModeStateRef = useRef<CarModeState | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  
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
      void loadCarRuntime()
        .then(async ({ initCarMode }) => {
          if (carModeStateRef.current || containerRef.current !== container) return;
          const {
            preloadWebGPUCabinRenderer,
            resolveCabinRendererPreference,
            createCabinRendererAsync,
          } = await import('../car/interior/createCabinRenderer');
          const { detectGPUProfile } = await import('../utils/performance');
          let readyHandle: Awaited<ReturnType<typeof createCabinRendererAsync>> | undefined;
          if (resolveCabinRendererPreference(currentSearch()) === 'webgpu') {
            await preloadWebGPUCabinRenderer().catch((err) => {
              console.error('[ViewModeProvider] Failed to preload the WebGPU cabin renderer; falling back to WebGL.', err);
            });
            readyHandle = await createCabinRendererAsync({
              gpuProfile: detectGPUProfile(),
              search: currentSearch(),
            });
          }
          if (!carModeStateRef.current && containerRef.current === container) {
            carModeStateRef.current = initCarMode(container, undefined, undefined, readyHandle);
          } else if (readyHandle) {
            try { readyHandle.renderer.dispose(); } catch { /* unused overlay */ }
          }
        })
        .catch((err) => {
          console.error('[ViewModeProvider] Failed to initialize car mode:', err);
        });
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

    void loadCarRuntime().then(({ toggleCarMode }) => {
      if (prevViewMode === 'car') {
        toggleCarMode(false);
      }

      if (viewMode === 'car' && carModeStateRef.current && containerRef.current) {
        toggleCarMode(true);
      }
    });
  }, [viewMode, prevViewMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (carModeStateRef.current) {
        void loadCarRuntime().then(({ disposeCarMode }) => {
          disposeCarMode();
          carModeStateRef.current = null;
        });
      }
    };
  }, []);
  
  // Memoized so consumers re-render only on real mode changes. `carModeState` is a
  // snapshot of the ref taken when another field changes (nothing reads it reactively).
  const value = useMemo<ViewModeState>(() => ({
    viewMode,
    setViewMode,
    toggleViewMode,
    controlMode,
    dispatchCabinInput,
    setCarHeading,
    carModeState: carModeStateRef.current,
    initCarModeForContainer,
    registerCarModeState,
  }), [
    viewMode, setViewMode, toggleViewMode, controlMode, dispatchCabinInput,
    setCarHeading, initCarModeForContainer, registerCarModeState,
  ]);
  
  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  );
};

export default ViewModeContext;
