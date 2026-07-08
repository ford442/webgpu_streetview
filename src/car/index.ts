import { CarInterior } from './CarInterior';
import { RearviewMirror } from './RearviewMirror';
import { SelectivePostProcessing } from './SelectivePostProcessing';
import { PanoLocationInfo } from '../utils/panoLocation';
import {
    VehicleType,
    DEFAULT_VEHICLE,
    vehicleManager,
} from './VehicleManager';
import {
    ConvertibleMode,
} from './variants';

export { CarInterior } from './CarInterior';
export { RearviewMirror } from './RearviewMirror';
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
    COLORS 
} from './DashboardLayout';
export { 
    SpeedGauge, 
    RpmGauge, 
    GearIndicator 
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
    VEHICLE_ICON
} from './Controls';

/**
 * CarMode state container holding all car view subsystems.
 */
export interface CarModeState {
    interior: CarInterior;
    mirror: RearviewMirror;
    postProcessing: SelectivePostProcessing;
    convertibleMode: ConvertibleMode | null;
    isActive: boolean;
    wipersEnabled: boolean;
    wiperSpeed: number;
    currentVehicle: VehicleType;
}

let carModeState: CarModeState | null = null;
let lastTimestamp = 0;

/**
 * Initialize car mode on a container element.
 * Sets up the Three.js car interior overlay, rearview mirror, and post-processing pipeline.
 *
 * @param container - The DOM element to mount the car interior overlay onto
 * @param initialVehicle - Initial vehicle type (defaults to 'sedan')
 * @returns CarModeState object for managing the car view
 */
export function initCarMode(container: HTMLElement, initialVehicle: VehicleType = DEFAULT_VEHICLE): CarModeState {
    // Create the car interior Three.js overlay
    const interior = new CarInterior(container);

    // Create the rearview mirror (renders into the car interior scene)
    const mirror = new RearviewMirror(interior.scene, interior.renderer);

    // Create post-processing settings manager
    const postProcessing = new SelectivePostProcessing();

    // Create convertible mode (manages roof, wind effects, sport features)
    const convertibleMode = new ConvertibleMode(
        interior.scene,
        interior.interiorGroup,
        interior.roofGroup
    );

    // Set initial vehicle type
    convertibleMode.setVehicleType(initialVehicle as any);

    carModeState = {
        interior,
        mirror,
        postProcessing,
        convertibleMode,
        isActive: false,
        wipersEnabled: false,
        wiperSpeed: 1.0,
        currentVehicle: initialVehicle,
    };

    // Sync with vehicle manager
    vehicleManager.setVehicle(initialVehicle);

    // Listen for vehicle changes from manager
    vehicleManager.onChange((vehicle) => {
        if (carModeState?.convertibleMode) {
            carModeState.convertibleMode.setVehicleType(vehicle as any);
            carModeState.currentVehicle = vehicle;
        }
    });

    return carModeState;
}

/**
 * Toggle car mode on/off.
 * When enabled, the car interior overlay renders on top of the Street View.
 * When disabled, only the standard Street View is visible.
 * 
 * @param enabled - Whether to enable or disable car mode
 */
export function toggleCarMode(enabled: boolean): void {
    if (!carModeState) return;

    carModeState.isActive = enabled;
    carModeState.interior.setActive(enabled);

    // Show/hide the Three.js canvas
    if (carModeState.interior.canvas) {
        const c = carModeState.interior.canvas;
        c.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 50;
            pointer-events: none;
            display: ${enabled ? 'block' : 'none'};
            visibility: ${enabled ? 'visible' : 'hidden'};
        `;
    }
}

/**
 * Set the Street View canvas source for the rearview mirror.
 * Call this whenever the Street View canvas changes.
 */
export function setMirrorStreetViewCanvas(canvas: HTMLCanvasElement | null): void {
    if (!carModeState) return;
    carModeState.mirror.setStreetViewCanvas(canvas);
    carModeState.interior.setVanityStreetViewCanvas(canvas);
}

/** Sync Three.js camera FOV with WebGPU shader zoom for window alignment. */
export function setCarZoomFOV(zoom: number): void {
    if (!carModeState) return;
    carModeState.interior.setZoomFOV(zoom);
}

/**
 * Toggle windshield wipers on/off.
 */
export function toggleWipers(): boolean {
    if (!carModeState) return false;
    carModeState.wipersEnabled = !carModeState.wipersEnabled;
    return carModeState.wipersEnabled;
}

/**
 * Set wiper speed (0.5 = slow, 1.0 = normal, 2.0 = fast).
 */
export function setWiperSpeed(speed: number): void {
    if (!carModeState) return;
    carModeState.wiperSpeed = Math.max(0.5, Math.min(2.0, speed));
}

/**
 * Get current wiper state.
 */
export function getWiperState(): { enabled: boolean; speed: number } {
    if (!carModeState) return { enabled: false, speed: 1.0 };
    return { enabled: carModeState.wipersEnabled, speed: carModeState.wiperSpeed };
}

/**
 * Update and render car mode elements each frame.
 * Should be called within the existing animation loop.
 *
 * @param carHeading - Car body heading in degrees (stays level with ground)
 * @param viewHeading - Current view heading in degrees (carHeading + headYawOffset)
 * @param headPitch - Current head pitch in degrees (up/down look)
 * @param carSpeed - Current car speed for wind effects in convertible mode (km/h)
 */
export function updateCarMode(carHeading: number, headYawOffset: number, headPitch: number, carSpeed: number = 0, nightIntensity: number = 0, headlightsOn: boolean = false, domeLightOn: boolean = false, mirrorHeading?: number): void {
    if (!carModeState || !carModeState.isActive) return;

    const now = performance.now();
    const deltaTime = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    // Update interior animations (roof, wipers, ambient particles, etc.)
    carModeState.interior.update(deltaTime, carSpeed);

    // Update convertible mode (wind particles, etc.)
    if (carModeState.convertibleMode) {
        carModeState.convertibleMode.update(deltaTime, carSpeed);
    }

    // Update car body rotation to stay level with ground (carHeading only)
    // This keeps dashboard, steering wheel, A-pillars fixed to the car body
    carModeState.interior.setCarOrientation(carHeading);

    // Update head/camera orientation for looking around inside the car
    // Head can look freely without affecting outside view
    carModeState.interior.setHeadOrientation(headYawOffset, headPitch);

    // Update mirror with the rear view (180° behind car heading)
    // The mirror shows what's actually behind the car based on Street View
    carModeState.mirror.update(mirrorHeading ?? carHeading, true); // skipFrame = true for performance

    carModeState.interior.updateVanityMirror(mirrorHeading ?? carHeading, headPitch);

    // Update interior lighting based on headlights, night intensity, and dome light
    carModeState.interior.setInteriorLighting(headlightsOn, nightIntensity, domeLightOn);

    // Render the car interior
    carModeState.interior.render();
}

/**
 * Update car steering angle (for steering wheel animation).
 * @param steeringInput - Steering angle in degrees (-90 to 90)
 */
export function setCarSteering(steeringInput: number): void {
    if (!carModeState) return;
    carModeState.interior.setSteeringAngle(steeringInput);
}

/**
 * Control car wipers.
 * @param active - Whether wipers should be active
 */
export function setCarWipers(active: boolean): void {
    if (!carModeState) return;
    carModeState.interior.setWipersActive(active);
}

/**
 * Set how far back the driver's eye sits from the default per-vehicle position.
 * @param offset - Distance in metres to dolly the camera back off the dashboard (0 = default).
 */
export function setCarSeatOffset(offset: number): void {
    if (!carModeState) return;
    carModeState.interior.setSeatOffset(offset);
}

/**
 * Update the dashboard location readout with the current panorama's metadata.
 */
export function setCarLocationInfo(info: PanoLocationInfo | null): void {
    if (!carModeState) return;
    carModeState.interior.setLocationInfo(info);
}

/**
 * Update the live compass heading shown on the location readout panel.
 */
export function setCarCompassHeading(heading: number): void {
    if (!carModeState) return;
    carModeState.interior.setCompassHeading(heading);
}

/**
 * Rebuild the cabin's IBL environment from the current panorama.
 * @param equirect - 2:1 equirect image of the pano (low-res is fine; it gets PMREM-filtered)
 * @param centerHeading - Compass heading at the horizontal centre of the image
 */
export function setCarPanoEnvironment(equirect: HTMLCanvasElement, centerHeading: number): void {
    if (!carModeState) return;
    carModeState.interior.setEnvironmentFromPano(equirect, centerHeading);
}

/**
 * Aim the cabin's sun light at the real sun for the pano's location/time.
 * @param azimuth  - SunCalc azimuth in radians (0 = south, positive west)
 * @param altitude - SunCalc altitude in radians (0 = horizon)
 */
export function setCarSunPosition(azimuth: number, altitude: number): void {
    if (!carModeState) return;
    carModeState.interior.setSunPosition(azimuth, altitude);
}

/**
 * Update dashboard gauges (speedometer, tachometer).
 * @param speed - Speed in km/h (0-100)
 * @param rpm - Engine RPM (0-8000)
 */
export function updateCarGauges(speed: number, rpm: number): void {
    if (!carModeState) return;
    carModeState.interior.setGaugeValues(speed, rpm);
}

/**
 * Toggle car headlights.
 */
export function toggleCarHeadlights(): boolean {
    if (!carModeState) return false;
    carModeState.interior.toggleHeadlights();
    return carModeState.interior.getHeadlightsState();
}

/**
 * Toggle the car's dome (interior cabin) light.
 * Returns the new dome light state.
 */
export function toggleCarDomeLight(): boolean {
    if (!carModeState) return false;
    return carModeState.interior.toggleDomeLight();
}

/**
 * Set car headlights to a specific state.
 */
export function setCarHeadlights(on: boolean): void {
    if (!carModeState) return;
    carModeState.interior.setHeadlights(on);
}

/**
 * Set the car's dome (interior cabin) light to a specific state.
 */
export function setCarDomeLight(on: boolean): void {
    if (!carModeState) return;
    carModeState.interior.setDomeLight(on);
}

/**
 * Get the current dome light state.
 */
export function getCarDomeLightState(): boolean {
    if (!carModeState) return false;
    return carModeState.interior.getDomeLightState();
}

/**
 * Update the media page on the centre display (radio station name/tags/state).
 */
export function setCarMediaInfo(name: string, tags: string, playing: boolean): void {
    if (!carModeState) return;
    carModeState.interior.setMediaInfo(name, tags, playing);
}

/**
 * Test whether screen coordinates hit the centre display screen.
 */
export function isCarCenterDisplayHit(clientX: number, clientY: number): boolean {
    if (!carModeState) return false;
    return carModeState.interior.isCenterDisplayHit(clientX, clientY);
}

/**
 * Cycle the centre display to its next page (nav → media → trip).
 * Returns the new page name, or null when no display exists.
 */
export function cycleCarDisplayPage(): string | null {
    if (!carModeState) return null;
    return carModeState.interior.cycleDisplayPage();
}

/**
 * Test whether screen coordinates hit the dome switch mesh.
 */
export function isCarDomeSwitchHit(clientX: number, clientY: number): boolean {
    if (!carModeState) return false;
    return carModeState.interior.isDomeSwitchHit(clientX, clientY);
}

/**
 * Hit-test whether the given screen coordinates fall on the steering wheel.
 * Returns false when car mode is not initialized.
 * @param clientX - Mouse clientX from a DOM MouseEvent
 * @param clientY - Mouse clientY from a DOM MouseEvent
 */
export function isCarSteeringWheelHit(clientX: number, clientY: number): boolean {
    if (!carModeState) return false;
    return carModeState.interior.isSteeringWheelHit(clientX, clientY);
}

/**
 * Toggle between sedan and convertible modes.
 * @returns The new vehicle type
 */
export function toggleVehicleType(): VehicleType {
    if (!carModeState) return DEFAULT_VEHICLE;

    const newType = vehicleManager.getCurrentVehicle() === 'sedan' ? 'convertible' : 'sedan';
    vehicleManager.setVehicle(newType);
    carModeState.currentVehicle = newType;

    if (carModeState.convertibleMode) {
        carModeState.convertibleMode.setVehicleType(newType as any);
    }

    return newType;
}

/**
 * Set specific vehicle type.
 * @param type - Vehicle type to switch to
 */
export function setVehicleType(type: VehicleType): void {
    if (!carModeState) return;

    vehicleManager.setVehicle(type);
    carModeState.currentVehicle = type;

    if (carModeState.convertibleMode) {
        carModeState.convertibleMode.setVehicleType(type as any);
    }
}

/**
 * Get current vehicle type.
 */
export function getCurrentVehicleType(): VehicleType {
    return carModeState?.currentVehicle ?? vehicleManager.getCurrentVehicle();
}

/**
 * Toggle convertible roof (only works in convertible mode).
 * @returns true if roof is now open, false if closed
 */
export function toggleConvertibleRoof(): boolean {
    if (!carModeState?.convertibleMode) return false;
    return carModeState.convertibleMode.toggleRoof();
}

/**
 * Toggle wind deflector (only works in convertible mode with roof open).
 * @returns true if deflector is now deployed
 */
export function toggleWindDeflector(): boolean {
    if (!carModeState?.convertibleMode) return false;
    return carModeState.convertibleMode.toggleWindDeflector();
}

/**
 * Set wind speed for convertible mode effects.
 * @param speed - Wind speed (0-100)
 */
export function setWindSpeed(speed: number): void {
    if (!carModeState?.convertibleMode) return;
    carModeState.convertibleMode.setWindSpeed(speed);
}

/**
 * Set window tint darkness for all glass surfaces.
 * @param value - Tint level 0.0 (clear) to 1.0 (dark)
 */
export function setWindowTint(value: number): void {
    if (!carModeState) return;
    carModeState.interior.updateWindowTint(value);
}

/**
 * Set wind turbulence for convertible mode.
 * @param turbulence - Turbulence level (0-1)
 */
export function setWindTurbulence(turbulence: number): void {
    if (!carModeState?.convertibleMode) return;
    carModeState.convertibleMode.setTurbulence(turbulence);
}

/**
 * Check if currently in convertible mode with open roof.
 */
export function isConvertibleOpen(): boolean {
    return carModeState?.convertibleMode?.isConvertibleOpen() ?? false;
}

/**
 * Toggle rain droplets on the windshield.
 */
export function setCarRainActive(active: boolean): void {
    if (!carModeState) return;
    carModeState.interior.setRainActive(active);
}

/** Weather-driven cabin glass + ambience (rain overlay, condensation, dust, wind). */
export function setCarWeatherAmbient(opts: {
    rainIntensity: number;
    wind: number;
    fogDensity: number;
    snowIntensity?: number;
    sunAltitude?: number;
    lightShaftFactor?: number;
    convertibleOpen?: boolean;
}): void {
    if (!carModeState) return;
    carModeState.interior.setWeatherAmbient(opts);
}

export function triggerCarInteriorPress(meshName: string): boolean {
    if (!carModeState) return false;
    return carModeState.interior.triggerInteriorPress(meshName);
}

export function setCarInteriorEditMode(enabled: boolean): void {
    if (!carModeState) return;
    carModeState.interior.setInteriorEditMode(enabled);
}

export function handleCarInteriorPointerDown(clientX: number, clientY: number, editMode: boolean): boolean {
    if (!carModeState) return false;
    return carModeState.interior.handleInteriorPointerDown(clientX, clientY, editMode);
}

export function handleCarInteriorPointerMove(clientX: number, clientY: number): boolean {
    if (!carModeState) return false;
    return carModeState.interior.handleInteriorPointerMove(clientX, clientY);
}

export function handleCarInteriorPointerUp(): void {
    if (!carModeState) return;
    carModeState.interior.handleInteriorPointerUp();
}

/**
 * Set 0-1 rain intensity: dims and diffuses the cabin daylight, suppresses
 * the low-sun window shafts, and drives the windshield droplet system.
 */
export function setCarWeather(rain: number): void {
    if (!carModeState) return;
    carModeState.interior.setWeatherIntensity(rain);
}

/**
 * Enable/disable post-processing (bloom + SMAA).
 */
export function setCarPostProcessingEnabled(enabled: boolean): void {
    if (!carModeState) return;
    carModeState.interior.setPostProcessingEnabled(enabled);
}

/**
 * Adjust bloom strength (0-1).
 */
export function setCarBloomStrength(strength: number): void {
    if (!carModeState) return;
    carModeState.interior.setBloomStrength(strength);
}

/**
 * Get current performance metrics string for debug overlay.
 */
export function getCarPerformanceString(): string {
    if (!carModeState) return '';
    return carModeState.interior.getPerformanceString();
}

/**
 * Dispose of all car mode resources.
 */
export function disposeCarMode(): void {
    if (!carModeState) return;

    carModeState.convertibleMode?.dispose();
    carModeState.interior.dispose();
    carModeState.mirror.dispose();
    carModeState.postProcessing.dispose();
    carModeState = null;
}
