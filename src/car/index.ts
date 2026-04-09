import { CarInterior } from './CarInterior';
import { RearviewMirror } from './RearviewMirror';
import { SelectivePostProcessing } from './SelectivePostProcessing';
import {
    VehicleType,
    VehicleConfig,
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
import {
    LimousineMode,
    LimoState,
    defaultLimoState,
    initLimousineMode,
} from './variants/LimousineMode';
import {
    ConvertibleMode,
    ConvertibleState,
    WindParticleSystem,
    SportDashboard,
    SportSeats,
    ConvertibleInterior,
} from './variants';
import {
    ScienceLabInterior,
    LabState,
    ScienceLabModeState,
    initScienceLabMode,
    initScienceLabModeSystem,
    toggleScienceLabMode,
    updateScienceLabMode,
    toggleUVLight,
    toggleLabEquipment,
    getLabState,
    disposeScienceLabMode,
} from './variants/ScienceLabMode';

export { CarInterior } from './CarInterior';
export { RearviewMirror } from './RearviewMirror';
export { SelectivePostProcessing } from './SelectivePostProcessing';
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

    // Show/hide the Three.js canvas
    if (carModeState.interior.canvas) {
        carModeState.interior.canvas.style.display = enabled ? 'block' : 'none';
        carModeState.interior.canvas.style.visibility = enabled ? 'visible' : 'hidden';
    }
}

/**
 * Set the Street View canvas source for the rearview mirror.
 * Call this whenever the Street View canvas changes.
 */
export function setMirrorStreetViewCanvas(canvas: HTMLCanvasElement | null): void {
    if (!carModeState) return;
    carModeState.mirror.setStreetViewCanvas(canvas);
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
export function updateCarMode(carHeading: number, headYawOffset: number, headPitch: number, carSpeed: number = 0, nightIntensity: number = 0, headlightsOn: boolean = false, domeLightOn: boolean = false): void {
    if (!carModeState || !carModeState.isActive) return;

    const now = performance.now();
    const deltaTime = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    // Update interior animations (roof, etc.)
    carModeState.interior.update(deltaTime);

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
    carModeState.mirror.update(carHeading, true); // skipFrame = true for performance

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
 * Get the current dome light state.
 */
export function getCarDomeLightState(): boolean {
    if (!carModeState) return false;
    return carModeState.interior.getDomeLightState();
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
