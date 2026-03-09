/**
 * Hooks index - Export all custom hooks
 */

export { useBookmarks } from './useBookmarks';
export { useLocationHistory } from './useLocationHistory';
export { useSnapshots } from './useSnapshots';
export { useVehicleSettings } from './useVehicleSettings';

// Mobile responsiveness hooks
export { useTouchControls, type UseTouchControlsOptions, type TouchGestureState } from './useTouchControls';
export { useDeviceDetection, type DeviceCapabilities, type QualitySettings } from './useDeviceDetection';

// New loading and transition hooks
export { 
  useLoadingState, 
  useGlobalLoadingState,
  type UseLoadingStateReturn 
} from './useLoadingState';

export { 
  useTransition, 
  useFadeTransition, 
  useVehicleTransition, 
  useCameraTransition, 
  usePanoramaLoading,
  easings,
  type TransitionOptions,
  type TransitionState,
  type EasingFunction,
} from './useTransition';

// Loading integration helpers
export {
  useStreetViewLoading,
  useVehicleLoading,
  useCameraLoading,
  useModelLoading,
  useRouteLoading,
  useSearchLoading,
  useAllLoadingStates,
} from './useLoadingIntegrations';

// Performance monitoring hook
export {
  usePerformanceMonitor,
  type FPSStats,
  type PerformanceMonitorConfig,
  type PerformanceMonitorState,
  type UsePerformanceMonitorReturn,
  type PerformanceOverlayProps,
  getPerformanceOverlayStyles,
  getFPSColor,
  formatPerformanceStats,
  markPerformance,
  measurePerformance,
  throttleToFPS,
  debounceFrame,
  supportsPerformanceObserver,
  createLongTaskObserver,
  getNavigationTiming,
} from './usePerformanceMonitor';
