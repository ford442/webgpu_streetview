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
