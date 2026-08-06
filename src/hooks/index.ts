/**
 * Hooks index - Export all custom hooks
 */

// Core context hooks
export { useStreetView, StreetViewProvider } from './useStreetView';
export { useViewMode, ViewModeProvider, type ViewMode, type ControlMode, type HeadCoupling } from './useViewMode';
export { useEnvironmentSettings, EnvironmentSettingsProvider, type TimeOfDay } from './useEnvironmentSettings';

export { useBookmarks } from './useBookmarks';
export { useLocationHistory } from './useLocationHistory';
export { useSnapshots } from './useSnapshots';
export { useVehicleSettings } from './useVehicleSettings';
export {
  useRearViewFeed,
  type UseRearViewFeedParams,
  type UseRearViewFeedResult,
  type RearViewFeedPose,
} from './useRearViewFeed';
export {
  useTours,
  type Tour,
  type TourWaypoint,
  type TourTransitionType,
  type CurrentPOV,
} from './useTours';

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

// Safe navigation hooks
export { usePanoramaCache } from './usePanoramaCache';
export { useAdvanceSafe } from './useAdvanceSafe';

// Offline route-graph prefetch (Phase 3)
export { useRoutePrefetch, type UseRoutePrefetchResult } from './useRoutePrefetch';

// Historical Timeline ("time travel") hooks
export { useHistoricalImagery, type UseHistoricalImageryResult } from './useHistoricalImagery';
export { useHistoricalTimeline, type UseHistoricalTimelineResult } from './useHistoricalTimeline';
export { useHistoricalCompare, type HistoricalComparison } from './useHistoricalCompare';

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

// Shared Exploration Sessions (multiplayer road trips)
export {
  useSharedSession,
  shouldApplyIncomingState,
  type SessionState,
  type SharedSessionRole,
  type SharedSessionStatus,
  type SharedSessionParticipant,
  type UseSharedSessionResult,
} from './useSharedSession';

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
