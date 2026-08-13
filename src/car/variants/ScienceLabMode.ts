/**
 * Science Lab mode façade — interior class lives in scienceLab/ScienceLabInterior.ts.
 */
export { ScienceLabInterior } from './scienceLab/ScienceLabInterior';
export type { LabState } from './scienceLab/ScienceLabInterior';

import { ScienceLabInterior, type LabState } from './scienceLab/ScienceLabInterior';

export function initScienceLabMode(container: HTMLElement): {
    interior: ScienceLabInterior;
    state: LabState;
} {
    const interior = new ScienceLabInterior(container);
    return { interior, state: interior.getEquipmentState() };
}

export interface ScienceLabModeState {
    interior: ScienceLabInterior;
    isActive: boolean;
}

let labModeState: ScienceLabModeState | null = null;
let lastTimestamp = 0;

export function initScienceLabModeSystem(container: HTMLElement): ScienceLabModeState {
    labModeState = { interior: new ScienceLabInterior(container), isActive: false };
    return labModeState;
}

export function toggleScienceLabMode(enabled: boolean): void {
    if (!labModeState) return;
    labModeState.isActive = enabled;
    if (labModeState.interior.canvas) {
        labModeState.interior.canvas.style.display = enabled ? 'block' : 'none';
        labModeState.interior.canvas.style.visibility = enabled ? 'visible' : 'hidden';
    }
}

export function updateScienceLabMode(carHeading: number, headYawOffset: number, headPitch: number): void {
    if (!labModeState || !labModeState.isActive) return;
    const now = performance.now();
    const deltaTime = (now - lastTimestamp) / 1000;
    lastTimestamp = now;
    labModeState.interior.update(deltaTime);
    labModeState.interior.setCarOrientation(carHeading);
    labModeState.interior.setHeadOrientation(headYawOffset, headPitch);
    labModeState.interior.render();
}

export function toggleUVLight(): boolean {
    return labModeState ? labModeState.interior.toggleUVLight() : false;
}

export function toggleLabEquipment(): boolean {
    return labModeState ? labModeState.interior.toggleEquipment() : false;
}

export function getLabState(): LabState | null {
    return labModeState ? labModeState.interior.getEquipmentState() : null;
}

export function disposeScienceLabMode(): void {
    if (!labModeState) return;
    labModeState.interior.dispose();
    labModeState = null;
}
