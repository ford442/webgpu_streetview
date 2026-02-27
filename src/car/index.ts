import { CarInterior } from './CarInterior';
import { RearviewMirror } from './RearviewMirror';
import { SelectivePostProcessing } from './SelectivePostProcessing';

export { CarInterior } from './CarInterior';
export { RearviewMirror } from './RearviewMirror';
export { SelectivePostProcessing } from './SelectivePostProcessing';

/**
 * CarMode state container holding all car view subsystems.
 */
export interface CarModeState {
    interior: CarInterior;
    mirror: RearviewMirror;
    postProcessing: SelectivePostProcessing;
    isActive: boolean;
    wipersEnabled: boolean;
    wiperSpeed: number;
}

let carModeState: CarModeState | null = null;
let lastTimestamp = 0;

/**
 * Initialize car mode on a container element.
 * Sets up the Three.js car interior overlay, rearview mirror, and post-processing pipeline.
 * 
 * @param container - The DOM element to mount the car interior overlay onto
 * @returns CarModeState object for managing the car view
 */
export function initCarMode(container: HTMLElement): CarModeState {
    // Create the car interior Three.js overlay
    const interior = new CarInterior(container);

    // Create the rearview mirror (renders into the car interior scene)
    const mirror = new RearviewMirror(interior.scene, interior.renderer);

    // Create post-processing settings manager
    const postProcessing = new SelectivePostProcessing();

    carModeState = {
        interior,
        mirror,
        postProcessing,
        isActive: false,
        wipersEnabled: false,
        wiperSpeed: 1.0,
    };

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
 */
export function updateCarMode(carHeading: number, viewHeading: number, headPitch: number): void {
    if (!carModeState || !carModeState.isActive) return;

    const now = performance.now();
    const deltaTime = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    // Update interior animations (roof, etc.)
    carModeState.interior.update(deltaTime);

    // Update car body rotation to stay level with ground (carHeading only)
    // This keeps dashboard, steering wheel, A-pillars fixed to the car body
    carModeState.interior.setCarOrientation(carHeading);

    // Update head/camera pitch for looking up/down inside the car
    // This only affects the camera view, not the car body or outside view
    carModeState.interior.setHeadPitch(headPitch);

    // Update mirror with the rear view (180° behind car heading)
    // The mirror shows what's actually behind the car based on Street View
    carModeState.mirror.update(carHeading, true); // skipFrame = true for performance

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
 * Dispose of all car mode resources.
 */
export function disposeCarMode(): void {
    if (!carModeState) return;

    carModeState.interior.dispose();
    carModeState.mirror.dispose();
    carModeState.postProcessing.dispose();
    carModeState = null;
}
