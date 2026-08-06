/**
 * Car mode public API — barrel re-exports plus runtime façade modules.
 */
export { CarInterior } from './CarInterior';
export { RearviewMirror } from './RearviewMirror';
export {
    RearViewFeed,
    REAR_VIEW_DEFAULTS,
    buildRearViewUrl,
    rearViewCacheKey,
    normalizeDeg,
    signedHeadingDelta,
} from './rearViewFeed';
export type {
    RearViewSample,
    RearViewRequest,
    RearViewResult,
    RearViewResultStatus,
    RearViewBlockReason,
    RearViewBlocker,
    RearViewFeedOptions,
    RearViewFeedStats,
} from './rearViewFeed';
export { SelectivePostProcessing } from './SelectivePostProcessing';
export { createMaterials } from './interior/MaterialFactory';
export type { MaterialSet } from './interior/MaterialFactory';
export { GeometryFactory } from './interior/GeometryFactory';
export { LODManager } from './interior/LODManager';
export { InteractionHelper } from './interior/InteractionHelper';
export { ClockRenderer } from './interior/ClockRenderer';
export { PostProcessingManager } from './interior/PostProcessingManager';
export { RainSystem } from './interior/RainSystem';
export { DustMoteSystem } from './interior/DustMoteSystem';
export { WindowWeatherOverlay } from './interior/WindowWeatherOverlay';
export { InteriorMicroInteractions } from './interior/InteriorMicroInteractions';
export {
    WIPER_STALK_POSITIONS,
    WIPER_STALK_SPEEDS,
    GEAR_POSITIONS,
    GEAR_HOP_COUNTS,
    gearHopCount,
    isGearParked,
} from './interior/CabinControls';
export type { WiperStalkPosition, GearPosition } from './interior/CabinControls';
export { VanityMirror } from './interior/VanityMirror';
export { PerformanceProfiler } from './interior/PerformanceProfiler';
export { buildInteriorLighting } from './interior/LightingBuilder';
export type { VehicleType, VehicleConfig } from './VehicleManager';
export {
    VEHICLES,
    VEHICLE_LIST,
    DEFAULT_VEHICLE,
    VehicleManager,
    vehicleManager,
    getVehicleConfig,
    isValidVehicleType,
    getNextVehicle,
    getPreviousVehicle,
} from './VehicleManager';
export {
    resolveGaugeLayout,
    resolveSteeringWheel,
    resolveCameraFov,
    zoomToVerticalFov,
    DEFAULT_GAUGE_LAYOUT,
    DEFAULT_STEERING_WHEEL,
    DEFAULT_CAMERA_FOV,
} from './vehicleLayout';
export type { GaugeLayoutConfig, SteeringWheelConfig, CameraFovConfig, GaugeLayoutOverrides, SteeringWheelOverrides, Vec3 } from './vehicleLayout';
export {
    ConvertibleMode,
    WindParticleSystem,
    SportDashboard,
    SportSeats,
    ConvertibleInterior,
} from './variants';
export type { ConvertibleState } from './variants';
export {
    ScienceLabInterior,
    initScienceLabMode,
    initScienceLabModeSystem,
    toggleScienceLabMode,
    updateScienceLabMode,
    toggleUVLight,
    toggleLabEquipment,
    getLabState,
    disposeScienceLabMode,
} from './variants/ScienceLabMode';
export type { LabState, ScienceLabModeState } from './variants/ScienceLabMode';
export {
    LimousineMode,
    defaultLimoState,
    initLimousineMode,
} from './variants/LimousineMode';
export type { LimoState } from './variants/LimousineMode';

// Dashboard UI Components
export { DashboardUI } from './DashboardUI';
export type { DashboardUIProps } from './DashboardUI';
export {
    DashboardContainer,
    ZoneLeft,
    ZoneCenter,
    ZoneRight,
    COLORS,
} from './DashboardLayout';
export {
    SpeedGauge,
    RpmGauge,
    GearIndicator,
    TelemetryChip,
} from './Gauges';
export {
    IconButton,
    Slider,
    AudioVisualizer,
    injectSliderStyles,
    GPS_ICON,
    RADIO_ICON,
    ROOF_ICON,
    WIPER_ICON,
    HEADLIGHT_ICON,
    HIGHBEAM_ICON,
    DOME_ICON,
    SNOW_ICON,
    RAIN_ICON,
    WIND_ICON,
    VEHICLE_ICON,
    REAR_MIRROR_ICON,
} from './Controls';

export type { CarModeState, CabinLeverHandlers } from './carModeRuntime';
export {
    initCarMode,
    toggleCarMode,
    setMirrorStreetViewCanvas,
    setMirrorRearSample,
    getMirrorStatus,
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
    updateCarMode,
    setCarSteering,
    setCarWipers,
    setCarSeatOffset,
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
    isCarCenterDisplayHit,
    cycleCarDisplayPage,
    isCarDomeSwitchHit,
    isCarSteeringWheelHit,
    toggleVehicleType,
    setVehicleType,
    getCurrentVehicleType,
    toggleConvertibleRoof,
    toggleWindDeflector,
    setWindSpeed,
    setWindowTint,
    setWindTurbulence,
    isConvertibleOpen,
    setCarRainActive,
    setCarWeatherAmbient,
    triggerCarInteriorPress,
    setCarInteriorEditMode,
    handleCarInteriorPointerDown,
    handleCarInteriorPointerMove,
    handleCarInteriorPointerUp,
    setCarWeather,
    setCarPostProcessingEnabled,
    setCarBloomStrength,
    getCarPerformanceString,
    disposeCarMode,
} from './carModeRuntime';
