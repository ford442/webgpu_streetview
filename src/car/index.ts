/**
 * Car mode public API — barrel re-exports plus runtime façade modules.
 */
export {
    GEAR_POSITIONS,
    gearHopCount,
} from './interior/CabinControls';
export type { WiperStalkPosition, GearPosition } from './interior/CabinControls';

// Dashboard UI Components

export type { CarModeState,  } from './carModeRuntime';
export {
    initCarMode,
    toggleCarMode,
    setMirrorStreetViewCanvas,
    setMirrorRearSample,
    setCarZoomFOV,
    cycleWiperStalk,
    setCarGear,
    setCabinLeverHandlers,
    updateCarMode,
    setCarSteering,
    setCarWipers,
    setCarSeatOffset,
    setCarLocationInfo,
    setCarCompassHeading,
    setCarRouteGuidance,
    setCarPanoEnvironment,
    setCarSunPosition,
    updateCarGauges,
    setCarMediaInfo,
    isCarCenterDisplayHit,
    cycleCarDisplayPage,
    getCurrentVehicleType,
    setWindowTint,
    isConvertibleOpen,
    setCarWeatherAmbient,
    triggerCarInteriorPress,
    setCarInteriorEditMode,
    handleCarInteriorPointerDown,
    pressCarInteriorAlongRay,
    handleCarInteriorPointerMove,
    handleCarInteriorPointerUp,
    setCarWeather,
    disposeCarMode,
} from './carModeRuntime';

// Lazy-side exports (#368): modules only the lazy car chunk reaches. Never import from main-bundle code.
export { CabinAudio } from './audio/CabinAudio';
export { DashboardUI } from './DashboardUI';
export { createCabinPovSync } from './input/cabinPovSync';
export { createCabinRendererAsync, preloadWebGPUCabinRenderer, resolveCabinRendererPreference } from './interior/createCabinRenderer';
export { detectGPUProfile } from './interior/performance';
export { RearViewFeed } from './rearViewFeed';
export { applyVehicleTelemetry } from './telemetryFeed';
