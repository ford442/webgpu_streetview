/**
 * Main-bundle-safe public entry of `src/car/` (#368): what the UI layer may import from code that ships in the main chunk.
 * Value exports of modules only the lazy car chunk reaches are NOT here — they are in `./index` (lazy-side API).
 * Everything else in the folder is internal — `scripts/check-architecture.mjs` (dependency-cruiser rule
 * `only-through-entry`) fails a deeper import. Keep it a pure re-export list: no logic, no side effects.
 */
export type { CabinEnvironment } from './audio/CabinAudio';
export type { CabinAudioProbe } from './audio/cabinAudioProbe';
export { getCabinView, isCabinView, setCabinView } from './cabinView';
export type { CabinView } from './cabinView';
export { loadCarRuntime, withCarRuntime } from './carRuntimeLoader';
export type { CarModeState } from './carRuntimeLoader';
export { INITIAL_CABIN_INPUT, applyPointerLockEffect, cabinInputMode, transitionCabinInput } from './input/cabinInputMachine';
export type { CabinInputEvent, CabinInputTransition, ControlMode } from './input/cabinInputMachine';
export { readCabinRendererProbe } from './interior/cabinRendererProbe';
export type { RearViewFeedStats, RearViewSample } from './rearViewFeed';
export { buildStudioShareUrl, parseStudioLinkParams } from './studioLink';
export { VehicleDynamics, gearChainedHopIntervalMs } from './VehicleDynamics';
export type { VehicleTelemetry } from './VehicleDynamics';
export { getVehicleConfig, isValidVehicleType, vehicleManager } from './VehicleManager';
export type { VehicleConfig, VehicleType } from './VehicleManager';
