import { CarInterior } from '../CarInterior';
import { RearviewMirror } from '../RearviewMirror';
import { SelectivePostProcessing } from '../SelectivePostProcessing';
import { ConvertibleMode } from '../variants';
import { DEFAULT_VEHICLE, vehicleManager, type VehicleType } from '../VehicleManager';
import { applyGearFromMesh, applyWiperStalk } from './cabinControls';
import { getState, setState, type CarModeState } from './state';

/**
 * Construction, per-frame update and teardown of the car cabin.
 *
 * This is the only module that builds the subsystems or clears the singleton;
 * everything else in `runtime/` reads them through `getState()`.
 */

let lastTimestamp = 0;

/**
 * Initialize car mode on a container element.
 * Sets up the Three.js car interior overlay, rearview mirror, and post-processing pipeline.
 *
 * @param container - The DOM element to mount the car interior overlay onto
 * @param initialVehicle - Initial vehicle type (defaults to 'sedan')
 * @returns CarModeState object for managing the car view
 */
export function initCarMode(
    container: HTMLElement,
    initialVehicle: VehicleType = DEFAULT_VEHICLE,
    /** Street View's shared `GPUDevice` — see `createCabinRenderer.ts` (`?cabin=webgpu`). */
    sharedDevice?: GPUDevice,
): CarModeState {
    // Create the car interior Three.js overlay
    const interior = new CarInterior(container, initialVehicle, sharedDevice);

    let mirror: RearviewMirror;
    try {
        // Create the rearview mirror (renders into the car interior scene)
        mirror = new RearviewMirror(interior.scene, interior.renderer);
    } catch (err) {
        interior.dispose();
        throw err;
    }
    const attachMirrors = () => {
        mirror.attachSideGlasses(interior.leftMirrorPlane, interior.rightMirrorPlane);
    };
    interior.onCabinSocketsChanged = attachMirrors;
    attachMirrors();

    // Create post-processing settings manager
    const postProcessing = new SelectivePostProcessing();

    // Create convertible mode (manages roof, wind effects, sport features)
    const convertibleMode = new ConvertibleMode(
        interior.scene,
        interior.interiorGroup,
        interior.roofGroup
    );

    // Set initial vehicle type
    convertibleMode.setVehicleType(initialVehicle);

    const state: CarModeState = {
        interior,
        mirror,
        postProcessing,
        convertibleMode,
        isActive: false,
        wipersEnabled: false,
        wiperSpeed: 1.0,
        currentVehicle: initialVehicle,
        wiperStalk: 'off',
        gear: 'D',
    };
    setState(state);

    interior.setLeverCallbacks({
        onWiperStalk: applyWiperStalk,
        onGear: applyGearFromMesh,
    });

    // Sync with vehicle manager
    vehicleManager.setVehicle(initialVehicle);

    // Listen for vehicle changes from manager
    vehicleManager.onChange((vehicle) => {
        const live = getState();
        if (live?.convertibleMode) {
            live.convertibleMode.setVehicleType(vehicle);
            live.currentVehicle = vehicle;
        }
    });

    return state;
}

/**
 * Toggle car mode on/off.
 * When enabled, the car interior overlay renders on top of the Street View.
 * When disabled, only the standard Street View is visible.
 *
 * @param enabled - Whether to enable or disable car mode
 */
export function toggleCarMode(enabled: boolean): void {
    const state = getState();
    if (!state) return;

    state.isActive = enabled;
    state.interior.setActive(enabled);

    // Show/hide the Three.js canvas
    if (state.interior.canvas) {
        const c = state.interior.canvas;
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
 * Update and render car mode elements each frame.
 * Should be called within the existing animation loop.
 *
 * @param carHeading - Car body heading in degrees (stays level with ground)
 * @param viewHeading - Current view heading in degrees (carHeading + headYawOffset)
 * @param headPitch - Current head pitch in degrees (up/down look)
 * @param carSpeed - Current car speed for wind effects in convertible mode (km/h)
 */
export function updateCarMode(carHeading: number, headYawOffset: number, headPitch: number, carSpeed: number = 0, nightIntensity: number = 0, headlightsOn: boolean = false, domeLightOn: boolean = false, mirrorHeading?: number): void {
    const state = getState();
    if (!state || !state.isActive) return;

    const now = performance.now();
    const deltaTime = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    // Update interior animations (roof, wipers, ambient particles, etc.)
    state.interior.update(deltaTime, carSpeed);

    // Update convertible mode (wind particles, etc.)
    if (state.convertibleMode) {
        state.convertibleMode.update(deltaTime, carSpeed);
    }

    // Update car body rotation to stay level with ground (carHeading only)
    // This keeps dashboard, steering wheel, A-pillars fixed to the car body
    state.interior.setCarOrientation(carHeading);

    // Update head/camera orientation for looking around inside the car
    // Head can look freely without affecting outside view
    state.interior.setHeadOrientation(headYawOffset, headPitch);

    // Re-register any bound rear sample against the *car body* heading — the
    // mirror lives in car-body space, so the head's view heading must not move
    // it (that was the epic #171 spatial bug).
    state.mirror.update(carHeading, true); // skipFrame = true for performance

    state.interior.updateVanityMirror(mirrorHeading ?? carHeading, headPitch);

    // Update interior lighting based on headlights, night intensity, and dome light
    state.interior.setInteriorLighting(headlightsOn, nightIntensity, domeLightOn);

    // Render the car interior
    state.interior.render();
}

/**
 * Dispose of all car mode resources.
 */
export function disposeCarMode(): void {
    const state = getState();
    if (!state) return;

    state.convertibleMode?.dispose();
    state.interior.dispose();
    state.mirror.dispose();
    state.postProcessing.dispose();
    setState(null);
}
