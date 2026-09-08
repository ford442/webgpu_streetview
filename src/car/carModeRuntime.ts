/**
 * Car-mode runtime façade.
 *
 * The implementation lives in `runtime/`, split by what each group of functions
 * actually touches:
 *
 * - `runtime/state.ts`          — the one owning module for the singleton
 * - `runtime/lifecycle.ts`      — init / toggle / per-frame update / dispose
 * - `runtime/cabinControls.ts`  — wiper stalk, gear, steering, seat, zoom FOV
 * - `runtime/vehicleSwitch.ts`  — vehicle type and the convertible-only features
 * - `runtime/telemetryBridge.ts`— app → cabin feeds (location, weather, gauges, lamps)
 * - `runtime/mirror.ts`         — rearview / vanity glass (billable imagery)
 * - `runtime/interaction.ts`    — pointer hit-testing against cabin meshes
 *
 * The re-exports below are written out by name rather than `export *` because
 * this surface is a contract: `src/car/index.ts` re-exports it item by item,
 * and `carRuntimeLoader.ts` / `AppShell.tsx` both type their lazy handle as
 * `typeof import('./carModeRuntime')`. Naming each export means a dropped or
 * renamed one is a compile error here, not a runtime `undefined` at a callsite.
 */

export type { CarModeState, CabinLeverHandlers } from './runtime/state';

export {
    initCarMode,
    toggleCarMode,
    updateCarMode,
    disposeCarMode,
} from './runtime/lifecycle';

export {
    setMirrorStreetViewCanvas,
    setMirrorRearSample,
    getMirrorStatus,
} from './runtime/mirror';

export {
    setCarZoomFOV,
    toggleWipers,
    setWiperStalkPosition,
    cycleWiperStalk,
    getWiperStalkPosition,
    setCarGear,
    getCarGear,
    getGearHopCount,
    setCabinLeverHandlers,
    setWiperSpeed,
    getWiperState,
    setCarSteering,
    setCarWipers,
    setCarSeatOffset,
} from './runtime/cabinControls';

export {
    setCarLocationInfo,
    setCarCompassHeading,
    setCarPanoEnvironment,
    setCarSunPosition,
    updateCarGauges,
    toggleCarHeadlights,
    toggleCarDomeLight,
    setCarHeadlights,
    setCarDomeLight,
    getCarDomeLightState,
    setCarMediaInfo,
    setCarRainActive,
    setCarWeatherAmbient,
    setCarWeather,
    setCarPostProcessingEnabled,
    setCarBloomStrength,
    getCarPerformanceString,
} from './runtime/telemetryBridge';

export {
    isCarCenterDisplayHit,
    cycleCarDisplayPage,
    isCarDomeSwitchHit,
    isCarSteeringWheelHit,
    triggerCarInteriorPress,
    setCarInteriorEditMode,
    handleCarInteriorPointerDown,
    handleCarInteriorPointerMove,
    handleCarInteriorPointerUp,
} from './runtime/interaction';

export {
    toggleVehicleType,
    setVehicleType,
    getCurrentVehicleType,
    toggleConvertibleRoof,
    toggleWindDeflector,
    setWindSpeed,
    setWindowTint,
    setWindTurbulence,
    isConvertibleOpen,
} from './runtime/vehicleSwitch';
