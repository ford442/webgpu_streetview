import {
    WIPER_STALK_POSITIONS,
    WIPER_STALK_SPEEDS,
    gearHopCount,
    type GearPosition,
    type WiperStalkPosition,
} from '../interior/CabinControls';
import { getLeverHandlers, getState, setLeverHandlers, type CabinLeverHandlers } from './state';

/**
 * The physical controls in the driver's reach: wiper stalk, gear selector,
 * steering wheel, seat, and the camera FOV that keeps the cabin's windows
 * aligned with the WebGPU panorama behind them.
 *
 * Both the 3D meshes and the HUD move these, so every mutation funnels through
 * `applyWiperStalk` / the gear setters and notifies the registered lever
 * handlers — that is what keeps the HUD mirroring whichever path moved first.
 */

/**
 * Toggle windshield wipers on/off (matches headlights/dome: mutates animator immediately).
 * Off ↔ low, keeping the physical stalk in step.
 */
export function toggleWipers(): boolean {
    const state = getState();
    if (!state) return false;
    const next = !state.wipersEnabled;
    setWiperStalkPosition(next ? 'low' : 'off');
    return next;
}

/**
 * Drive the animator from a stalk detent (shared by mesh + HUD paths) and
 * notify listeners so the HUD mirrors whichever path moved the stalk.
 */
export function applyWiperStalk(position: WiperStalkPosition): void {
    const state = getState();
    if (!state) return;
    if (state.wiperStalk === position) return;
    const active = position !== 'off';
    state.wiperStalk = position;
    state.wipersEnabled = active;
    state.wiperSpeed = WIPER_STALK_SPEEDS[position];
    state.interior.setWiperSpeed(state.wiperSpeed);
    state.interior.setWiperIntermittent(position === 'intermittent');
    state.interior.setWipersActive(active);
    getLeverHandlers().onWiperStalk?.(position);
}

/**
 * Set the wiper stalk detent from outside the 3D scene (HUD fallback,
 * keyboard shortcut). Moves the stalk mesh to match.
 */
export function setWiperStalkPosition(position: WiperStalkPosition): void {
    const state = getState();
    if (!state) return;
    applyWiperStalk(position);
    state.interior.syncWiperStalkMesh(position);
}

/** Advance the wiper stalk one detent, wrapping High → Off. */
export function cycleWiperStalk(): WiperStalkPosition {
    const state = getState();
    if (!state) return 'off';
    const next = WIPER_STALK_POSITIONS[
        (WIPER_STALK_POSITIONS.indexOf(state.wiperStalk) + 1) % WIPER_STALK_POSITIONS.length
    ]!;
    setWiperStalkPosition(next);
    return next;
}

export function getWiperStalkPosition(): WiperStalkPosition {
    return getState()?.wiperStalk ?? 'off';
}

/**
 * Record a gear the shifter *mesh* has already moved to, so the mesh is not
 * commanded back to where it already is. `setCarGear` is the outside-in twin.
 */
export function applyGearFromMesh(gear: GearPosition): void {
    const state = getState();
    if (!state || state.gear === gear) return;
    state.gear = gear;
    getLeverHandlers().onGear?.(gear);
}

/** Set the gear selector from outside the 3D scene; moves the shifter mesh. */
export function setCarGear(gear: GearPosition): void {
    const state = getState();
    if (!state || state.gear === gear) return;
    state.gear = gear;
    state.interior.syncShifterMesh(gear);
    getLeverHandlers().onGear?.(gear);
}

export function getCarGear(): GearPosition {
    return getState()?.gear ?? 'D';
}

/** Panorama hops the current gear consumes per forward input / cruise tick. */
export function getGearHopCount(): number {
    return gearHopCount(getCarGear());
}

/**
 * Register handlers for driver-initiated stalk / shifter moves so the HUD and
 * app state can mirror the physical controls.
 */
export function setCabinLeverHandlers(handlers: CabinLeverHandlers): void {
    setLeverHandlers(handlers);
}

/**
 * Set wiper speed directly (0.5 = slow, 1.0 = normal, 2.0 = fast).
 * Prefer `setWiperStalkPosition` so the stalk mesh stays in sync.
 */
export function setWiperSpeed(speed: number): void {
    const state = getState();
    if (!state) return;
    state.wiperSpeed = Math.max(0.5, Math.min(2.0, speed));
    state.interior.setWiperSpeed(state.wiperSpeed);
}

/**
 * Get current wiper state.
 */
export function getWiperState(): { enabled: boolean; speed: number } {
    const state = getState();
    if (!state) return { enabled: false, speed: 1.0 };
    return { enabled: state.wipersEnabled, speed: state.wiperSpeed };
}

/**
 * Update car steering angle (for steering wheel animation).
 * @param steeringInput - Steering angle in degrees (-90 to 90)
 */
export function setCarSteering(steeringInput: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setSteeringAngle(steeringInput);
}

/**
 * Control car wipers.
 * @param active - Whether wipers should be active
 */
export function setCarWipers(active: boolean): void {
    const state = getState();
    if (!state) return;
    if (active === state.wipersEnabled) return;
    setWiperStalkPosition(active ? 'low' : 'off');
}

/**
 * Set how far back the driver's eye sits from the default per-vehicle position.
 * @param offset - Distance in metres to dolly the camera back off the dashboard (0 = default).
 */
export function setCarSeatOffset(offset: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setSeatOffset(offset);
}

/** Sync Three.js camera FOV with WebGPU shader zoom for window alignment. */
export function setCarZoomFOV(zoom: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setZoomFOV(zoom);
}
