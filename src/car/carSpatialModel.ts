/**
 * Car spatial world model + visual correctness constants (epic #171).
 *
 * World model
 * -----------
 * - **Car body / chassis** (`carHeading`): yaw of the vehicle in world space.
 *   Dashboard, A-pillars, steering wheel, and mirror frame are locked to this.
 * - **Head / free-look** (`heading` / `pitch` in StreetViewProvider): independent
 *   look direction. In `controlMode === 'freeLook'` (and `headCoupling === 'free'`),
 *   mouse drag pans the head only — it must **not** rotate the chassis.
 * - **Steering** rotates `carHeading` only when:
 *     1. `controlMode === 'carSteer'`, or
 *     2. temporary steer from grabbing the steering wheel (`isTempSteerMode`), or
 *     3. explicit steer keys while in `carSteer` (A/D, Q/E).
 *   Shift / RMB / wheel alone must not steer in free-look.
 *
 * Night exposure floors (shared by WGSL + GLSL reference comments/tests)
 * ---------------------------------------------------------------------
 * Full night multiplies scene luminance toward NIGHT_BASE_FLOOR (not near-zero),
 * keeps sky readable via NIGHT_SKY_FLOOR, and lets headlights/dome lift the road.
 */

import { signedAngleDiff } from '../utils/navigation';

/** Minimum scene luminance scale at full night (was ~0.03 — crushed black). */
export const NIGHT_BASE_FLOOR = 0.14;

/** Minimum sky luminance scale at full night (was ~0.02). */
export const NIGHT_SKY_FLOOR = 0.18;

/** Desaturation amount at full night (0–1). */
export const NIGHT_DESATURATE = 0.55;

/** GLSL reference mix toward cool night tint at full night (SDR approximation). */
export const NIGHT_WEBGL_TINT = { r: 0.42, g: 0.50, b: 0.64 } as const;

/**
 * Particle fall direction in top-origin UV space (uv.y = 0 at top, 1 at bottom).
 * Negative Y velocity ⇒ flakes/streaks move downward on screen.
 * WebGPU fragCoord and the GLSL reference (which flips vUv.y) both use top-origin.
 */
export const WEATHER_FALL_Y_SIGN = -1 as const;

/** Static wiper blade angle (radians past park) used at low quality when "on". */
export const WIPER_LOW_QUALITY_ON_OFFSET = Math.PI / 5;

/** Parked wiper base angle (radians). */
export const WIPER_PARK_ANGLE = Math.PI / 6;

/**
 * StereoPannerNode pan from signed head-vs-chassis yaw.
 * Looking right of the car body → positive (right ear). Clamped to [-1, 1].
 */
export function cabinAudioPanFromHeadYaw(headHeading: number, carHeading: number): number {
  const signed = signedAngleDiff(headHeading, carHeading);
  return Math.max(-1, Math.min(1, signed / 90));
}

/**
 * Whether a free-look mouse drag should steer the chassis.
 * Only steering-wheel grabs (temp-steer handoff frames) may steer in free-look.
 * RMB / Shift alone must not.
 */
export function freeLookDragShouldSteer(opts: {
  isSteeringWheelDrag: boolean;
  isRightMouse?: boolean;
  shiftKey?: boolean;
}): boolean {
  // Explicitly ignore RMB/shift — documented free-look contract.
  void opts.isRightMouse;
  void opts.shiftKey;
  return opts.isSteeringWheelDrag === true;
}

/** Low-quality static "on" pose for left/right wiper z-rotation (radians). */
export function wiperLowQualityOnPose(): { left: number; right: number } {
  const offset = WIPER_LOW_QUALITY_ON_OFFSET;
  const park = WIPER_PARK_ANGLE;
  return {
    left: -offset - park,
    right: offset + park,
  };
}

/** Parked wiper pose (off, or intermittent dwell). */
export function wiperParkPose(): { left: number; right: number } {
  const park = WIPER_PARK_ANGLE;
  return { left: -park, right: park };
}

/**
 * Y delta applied to weather particle UVs per unit time in top-origin space.
 * Always negative so snow/rain fall downward on WebGPU and WebGL.
 */
export function weatherParticleYDelta(speed: number, time: number): number {
  return WEATHER_FALL_Y_SIGN * Math.abs(speed) * time;
}

/**
 * Night luminance scale after the smoothstep darkening curve.
 * `night` in [0,1]; returns mix(1, NIGHT_BASE_FLOOR, smoothstep(night)).
 */
export function nightBaseLuminance(night: number): number {
  const n = Math.min(1, Math.max(0, night));
  const curve = n * n * (3 - 2 * n);
  return 1 * (1 - curve) + NIGHT_BASE_FLOOR * curve;
}
