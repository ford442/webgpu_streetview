import type { CarInterior } from '../CarInterior';
import type { RearviewMirror } from '../RearviewMirror';
import type { SelectivePostProcessing } from '../SelectivePostProcessing';
import type { ConvertibleMode } from '../variants';
import type { VehicleType } from '../VehicleManager';
import type { GearPosition, WiperStalkPosition } from '../interior/CabinControls';

/**
 * The one place car-mode singleton state lives.
 *
 * `carModeRuntime` is a module-level singleton facade: every one of its ~55
 * exported functions reads or writes this state. When that facade was split
 * into `runtime/`, the hazard was each slice ending up with its own copy —
 * which still type-checks, still passes every module in isolation, and fails
 * only at runtime when a value written through one function is invisible to
 * another. Hence a single owning module with accessors, rather than a `let`
 * per file. Pinned by `__tests__/carModeRuntime.characterization.test.ts`.
 */

/** CarMode state container holding all car view subsystems. */
export interface CarModeState {
    interior: CarInterior;
    mirror: RearviewMirror;
    postProcessing: SelectivePostProcessing;
    convertibleMode: ConvertibleMode | null;
    isActive: boolean;
    wipersEnabled: boolean;
    wiperSpeed: number;
    currentVehicle: VehicleType;
    /** Physical wiper stalk detent. */
    wiperStalk: WiperStalkPosition;
    /** Physical gear selector position. */
    gear: GearPosition;
}

/** Fired when the driver moves a cabin lever in the 3D scene. */
export interface CabinLeverHandlers {
    onWiperStalk?: (position: WiperStalkPosition) => void;
    onGear?: (gear: GearPosition) => void;
}

let carModeState: CarModeState | null = null;
let leverHandlers: CabinLeverHandlers = {};

/** Null whenever car mode is not running — every accessor guards on this. */
export function getState(): CarModeState | null {
    return carModeState;
}

export function setState(next: CarModeState | null): void {
    carModeState = next;
}

export function getLeverHandlers(): CabinLeverHandlers {
    return leverHandlers;
}

export function setLeverHandlers(handlers: CabinLeverHandlers): void {
    leverHandlers = handlers;
}
