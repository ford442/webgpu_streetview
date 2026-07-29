/**
 * Shared definitions for the physical cabin stalks/levers so the 3D meshes,
 * the car-mode API and the HUD fallbacks all agree on position names,
 * ordering and behaviour.
 */

export const WIPER_STALK_POSITIONS = ['off', 'intermittent', 'low', 'high'] as const;
export type WiperStalkPosition = (typeof WIPER_STALK_POSITIONS)[number];

/** Sweep-rate multiplier fed to the animator for each stalk detent. */
export const WIPER_STALK_SPEEDS: Record<WiperStalkPosition, number> = {
    off: 0.5,
    intermittent: 0.6,
    low: 1.0,
    high: 2.0,
};

export const GEAR_POSITIONS = ['P', 'R', 'N', 'D', '2', '3'] as const;
export type GearPosition = (typeof GEAR_POSITIONS)[number];

/**
 * Panorama hops consumed per forward input (or cruise tick) in each gear.
 * P/N are parked, R reverses a single hop, D/2/3 step 1/2/3 panoramas.
 */
export const GEAR_HOP_COUNTS: Record<GearPosition, number> = {
    P: 0,
    R: 1,
    N: 0,
    D: 1,
    '2': 2,
    '3': 3,
};

/** Gears that hold the car still regardless of throttle input. */
export function isGearParked(gear: GearPosition): boolean {
    return GEAR_HOP_COUNTS[gear] === 0;
}

export function gearHopCount(gear: GearPosition): number {
    return GEAR_HOP_COUNTS[gear];
}

/** Mesh names used for raycast lookups and HUD-driven lever moves. */
export const WIPER_STALK_MESH = 'wiperStalk';
export const SHIFTER_KNOB_MESH = 'shifterKnob';

/** Stalk tilt (radians about local X) for off → intermittent → low → high. */
export const WIPER_STALK_DETENTS = [0.18, 0.06, -0.06, -0.18];

/** Shifter tilt (radians about local X) for P → R → N → D → 2 → 3. */
export const SHIFTER_DETENTS = GEAR_POSITIONS.map(
    (_, i) => -0.45 + (0.9 * i) / (GEAR_POSITIONS.length - 1)
);
