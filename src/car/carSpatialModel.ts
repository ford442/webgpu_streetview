/**
 * Car spatial world model + visual correctness constants (epic #171).
 *
 * World model
 * -----------
 * The Three.js cabin scene **is the car's frame**. Nothing in it turns with the
 * world; world turning is expressed only through the Street View panorama.
 *
 * - **Car rig** (`interiorGroup`): holds the shell, dashboard, steering wheel,
 *   mirrors. Identity rotation, always — it never rotates for mouse input,
 *   steering, or `carHeading`.
 * - **Head pivot** (`headPivot`, child of the car rig at the driver's eye
 *   point) → **camera** (child of the pivot, `rotation.order = 'YXZ'`). The
 *   camera's local rotation is the head pose and nothing else. The interior is
 *   never a child of the camera or the pivot.
 * - **State**: `carHeading` (deg, compass, clockwise from north, `povStore`)
 *   and `headYaw` / `headPitch` (radians, car-local, +yaw = look LEFT,
 *   +pitch = look UP, `cabinHeadStore`). The Street View POV is *derived*
 *   from them once per frame by `panoramaPovFromCabin` — the minus sign there
 *   is the compass (clockwise) vs Three.js (counter-clockwise) convention gap.
 * - **World-anchored cabin lighting** (sun light, pano IBL) is placed at the
 *   compass bearing *relative to the car* (`carRelativeBearing`), since the
 *   scene itself never yaws.
 * - **Input modes** (`car/input/cabinInputMachine.ts`): only STEER changes
 *   `carHeading` from the mouse; FREE_LOOK changes the head only;
 *   UI_INTERACT changes nothing but the cursor.
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

const DEG = Math.PI / 180;

const normalize360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Head yaw clamp: ±90° (radians). */
export const HEAD_YAW_LIMIT = Math.PI / 2;
/** Head pitch clamp: −45°..+45° (radians). */
export const HEAD_PITCH_MIN = -Math.PI / 4;
export const HEAD_PITCH_MAX = Math.PI / 4;

export function clampHeadYaw(yaw: number): number {
  return Math.max(-HEAD_YAW_LIMIT, Math.min(HEAD_YAW_LIMIT, yaw));
}

export function clampHeadPitch(pitch: number): number {
  return Math.max(HEAD_PITCH_MIN, Math.min(HEAD_PITCH_MAX, pitch));
}

/**
 * The Street View POV for a car heading + car-local head pose — the one
 * place the panorama's heading/pitch come from in car mode.
 *
 * `headYaw` is +left (Three.js, counter-clockwise) while compass heading is
 * clockwise, hence `carHeading − yaw`.
 */
export function panoramaPovFromCabin(
  carHeading: number,
  headYaw: number,
  headPitch: number,
): { heading: number; pitch: number } {
  return {
    heading: normalize360(carHeading - headYaw / DEG),
    pitch: headPitch / DEG,
  };
}

/**
 * Compass bearing → bearing relative to the car's nose (degrees, clockwise).
 * Anything world-anchored in the cabin scene (sun, pano IBL) goes through this,
 * because the scene is the car's frame and never yaws itself.
 */
export function carRelativeBearing(compassBearing: number, carHeading: number): number {
  return normalize360(compassBearing - carHeading);
}

/** Frame-rate-independent exponential decay toward 0: `x · e^(−k·dt)`. */
export function dampTowardZero(x: number, k: number, dt: number): number {
  return x * Math.exp(-k * Math.max(0, dt));
}

/** Rate (1/s) the head eases back to centre while steering. */
export const STEER_HEAD_RECENTER_RATE = 4;

/** Mouse-look sensitivity in FREE_LOOK (radians per pixel of movement). */
export const FREE_LOOK_RAD_PER_PX = 0.0025;

/** Mouse steering sensitivity in STEER (degrees of carHeading per pixel). */
export const STEER_DEG_PER_PX = 0.15;

/** Fastest the chassis may yaw from mouse steering (degrees per second). */
export const MAX_STEER_RATE_DPS = 180;

/**
 * Mouse-X → `carHeading` delta (degrees), rate-limited to
 * `MAX_STEER_RATE_DPS` over the time since the previous steer event (`dtS`,
 * clamped to a frame-ish window so one stalled event can't snap the car).
 */
export function steerDeltaFromMouse(movementX: number, dtS: number): number {
  const window = Math.min(0.1, Math.max(1 / 240, dtS));
  const limit = MAX_STEER_RATE_DPS * window;
  return Math.max(-limit, Math.min(limit, movementX * STEER_DEG_PER_PX));
}

/**
 * StereoPannerNode pan from signed head-vs-chassis yaw.
 * Looking right of the car body → positive (right ear). Clamped to [-1, 1].
 */
export function cabinAudioPanFromHeadYaw(headHeading: number, carHeading: number): number {
  const signed = signedAngleDiff(headHeading, carHeading);
  return Math.max(-1, Math.min(1, signed / 90));
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

/**
 * Roof group travel. The shell builder authors the headliner, dome fixture and
 * its halo at their *cabin* heights inside `roofGroup` (local y ≈ 1.6, level
 * with the A-pillar tops and the ceiling-mounted dome switch), so the closed
 * group sits at the origin. Convertibles slide it below the floor when open
 * (ConvertibleMode also hides it). Offsetting the closed group by the roof
 * height again floated the whole ceiling ~1.6 m above the pillars, with the
 * dome fixture out of every normal view.
 */
export const ROOF_CLOSED_Y = 0;
export const ROOF_OPEN_Y = -2.6;
