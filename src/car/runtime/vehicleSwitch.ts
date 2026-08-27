import { DEFAULT_VEHICLE, vehicleManager, type VehicleType } from '../VehicleManager';
import { getState } from './state';

/**
 * Which vehicle the driver is sitting in, and the convertible-only features
 * that come with the open-air variants (roof, deflector, wind, tint).
 *
 * `vehicleManager` is the source of truth for the type; `currentVehicle` on the
 * runtime state is a mirror of it, and `initCarMode`'s `onChange` subscription
 * keeps the two in step when something else moves the manager.
 */

/**
 * Toggle between sedan and convertible modes.
 * @returns The new vehicle type
 */
export function toggleVehicleType(): VehicleType {
    const state = getState();
    if (!state) return DEFAULT_VEHICLE;

    const newType = vehicleManager.getCurrentVehicle() === 'sedan' ? 'convertible' : 'sedan';
    vehicleManager.setVehicle(newType);
    state.currentVehicle = newType;

    if (state.convertibleMode) {
        state.convertibleMode.setVehicleType(newType);
    }

    return newType;
}

/**
 * Set specific vehicle type.
 * @param type - Vehicle type to switch to
 */
export function setVehicleType(type: VehicleType): void {
    const state = getState();
    if (!state) return;

    vehicleManager.setVehicle(type);
    state.currentVehicle = type;

    if (state.convertibleMode) {
        state.convertibleMode.setVehicleType(type);
    }
}

/**
 * Get current vehicle type.
 */
export function getCurrentVehicleType(): VehicleType {
    return getState()?.currentVehicle ?? vehicleManager.getCurrentVehicle();
}

/**
 * Toggle convertible roof (only works in convertible mode).
 * @returns true if roof is now open, false if closed
 */
export function toggleConvertibleRoof(): boolean {
    const state = getState();
    if (!state?.convertibleMode) return false;
    return state.convertibleMode.toggleRoof();
}

/**
 * Toggle wind deflector (only works in convertible mode with roof open).
 * @returns true if deflector is now deployed
 */
export function toggleWindDeflector(): boolean {
    const state = getState();
    if (!state?.convertibleMode) return false;
    return state.convertibleMode.toggleWindDeflector();
}

/**
 * Set wind speed for convertible mode effects.
 * @param speed - Wind speed (0-100)
 */
export function setWindSpeed(speed: number): void {
    const state = getState();
    if (!state?.convertibleMode) return;
    state.convertibleMode.setWindSpeed(speed);
}

/**
 * Set window tint darkness for all glass surfaces.
 * @param value - Tint level 0.0 (clear) to 1.0 (dark)
 */
export function setWindowTint(value: number): void {
    const state = getState();
    if (!state) return;
    state.interior.updateWindowTint(value);
}

/**
 * Set wind turbulence for convertible mode.
 * @param turbulence - Turbulence level (0-1)
 */
export function setWindTurbulence(turbulence: number): void {
    const state = getState();
    if (!state?.convertibleMode) return;
    state.convertibleMode.setTurbulence(turbulence);
}

/**
 * Check if currently in convertible mode with open roof.
 */
export function isConvertibleOpen(): boolean {
    return getState()?.convertibleMode?.isConvertibleOpen() ?? false;
}
