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
    }
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

    // Update mirror orientation based on car heading (always shows behind the car)
    // The mirror stays locked to the car body, not the driver's head
    carModeState.mirror.updateOrientation(carHeading, headPitch);

    // Render the car interior
    carModeState.interior.render();
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
