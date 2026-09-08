import { getState } from './state';

/**
 * Pointer hit-testing against cabin meshes.
 *
 * Callers use the boolean returns to decide whether a pointer event was
 * consumed by the cabin, so returning `false` when car mode is not running is
 * load-bearing: it hands the event back to the panorama.
 */

/**
 * Test whether screen coordinates hit the centre display screen.
 */
export function isCarCenterDisplayHit(clientX: number, clientY: number): boolean {
    const state = getState();
    if (!state) return false;
    return state.interior.isCenterDisplayHit(clientX, clientY);
}

/**
 * Cycle the centre display to its next page (nav → media → trip).
 * Returns the new page name, or null when no display exists.
 */
export function cycleCarDisplayPage(): string | null {
    const state = getState();
    if (!state) return null;
    return state.interior.cycleDisplayPage();
}

/**
 * Test whether screen coordinates hit the dome switch mesh.
 */
export function isCarDomeSwitchHit(clientX: number, clientY: number): boolean {
    const state = getState();
    if (!state) return false;
    return state.interior.isDomeSwitchHit(clientX, clientY);
}

/**
 * Hit-test whether the given screen coordinates fall on the steering wheel.
 * Returns false when car mode is not initialized.
 * @param clientX - Mouse clientX from a DOM MouseEvent
 * @param clientY - Mouse clientY from a DOM MouseEvent
 */
export function isCarSteeringWheelHit(clientX: number, clientY: number): boolean {
    const state = getState();
    if (!state) return false;
    return state.interior.isSteeringWheelHit(clientX, clientY);
}

export function triggerCarInteriorPress(meshName: string): boolean {
    const state = getState();
    if (!state) return false;
    return state.interior.triggerInteriorPress(meshName);
}

export function setCarInteriorEditMode(enabled: boolean): void {
    const state = getState();
    if (!state) return;
    state.interior.setInteriorEditMode(enabled);
}

export function handleCarInteriorPointerDown(clientX: number, clientY: number, editMode: boolean): boolean {
    const state = getState();
    if (!state) return false;
    return state.interior.handleInteriorPointerDown(clientX, clientY, editMode);
}

export function handleCarInteriorPointerMove(clientX: number, clientY: number): boolean {
    const state = getState();
    if (!state) return false;
    return state.interior.handleInteriorPointerMove(clientX, clientY);
}

export function handleCarInteriorPointerUp(): void {
    const state = getState();
    if (!state) return;
    state.interior.handleInteriorPointerUp();
}
