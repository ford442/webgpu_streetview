/**
 * Public entry of `src/state/`: what higher layers (engine, car, ui) may import.
 * Everything else in the folder is internal — `scripts/check-architecture.mjs` (dependency-cruiser rule
 * `only-through-entry`) fails a deeper import. Keep it a pure re-export list: no logic, no side effects.
 */
export { cabinHeadOffsetStore } from './cabinHeadOffsetStore';
export { cabinHeadStore } from './cabinHeadStore';
export type { CabinHeadStore } from './cabinHeadStore';
export { createStore, useStore } from './createStore';
export type { Store } from './createStore';
export { publishCruiseFlag, useCruiseFlag } from './cruiseFlagStore';
export { liveConditionsStore, useLiveConditions } from './liveConditionsStore';
export { isPanelOpen, setPanelOpen, usePanelsState } from './panelsStore';
export type { PanelId } from './panelsStore';
export { povStore, usePovEffect, useThrottledPov } from './povStore';
export type { PovStore } from './povStore';
export { isReducedMotion, setAppReducedMotion } from './reducedMotionStore';
export { sceneDepthStore, useSceneDepthOptIn } from './sceneDepthStore';
export { sceneSemanticStore, useSceneSemanticOptIn } from './sceneSemanticStore';
export { nextStep, tripProbeSnapshot, tripStore, useTripSelector } from './tripStore';
export type { OfflineDriveStats, TripProgress, TripState, TripStop, TripStore, TripSummary } from './tripStore';
