/**
 * Pure night/day intensity ramps for the cabin light rig.
 * LightingManager applies these as lerp targets; keep this file Three-free
 * so the look can be unit-tested without a WebGL context.
 */

export interface CabinFillTargets {
  hemi: number;
  ambient: number;
  overhead: number;
  leftWindow: number;
  rightWindow: number;
  bounce: number;
  dash: number;
  dome: number;
  headlights: number;
}

export interface CabinEmitterTargets {
  cluster: number;
  centerDisplay: number;
  clock: number;
  domeFixture: number;
  domeSwitch: number;
}

export interface CabinRampInput {
  /** 0 = full day, 1 = full night (max of preset + sun altitude). */
  effectiveNight: number;
  /** 0-1 rain / overcast. */
  rain: number;
  headlightsOn: boolean;
  domeLightOn: boolean;
  /** Science-lab clinical theme: cooler, slightly brighter day fill. */
  clinical?: boolean;
}

/** Below-horizon night factor; fully night by nautical twilight (~-12°). */
export function sunNightFactorFromAltitude(altitudeRad: number): number {
  if (altitudeRad >= 0) return 0;
  return Math.min(1, -altitudeRad / 0.21);
}

/** Direct-sun strength: ramps in over the first ~14° of altitude. */
export function sunStrengthFromAltitude(altitudeRad: number): number {
  return Math.max(0, Math.min(1, Math.sin(altitudeRad) / 0.25));
}

/** Daytime sun directional intensity before weather attenuation. */
export function sunBaseIntensityFromStrength(strength: number): number {
  return strength * 1.55;
}

/** Pano IBL contribution: keep enough by day for leather/dash, dim hard at night. */
export function iblIntensityFromNight(effectiveNight: number): number {
  const n = Math.max(0, Math.min(1, effectiveNight));
  return 1 - n * 0.82;
}

/**
 * Accent-trim / button backlight scale.
 * Day: almost off so bezels don't keep a night-cyan wash.
 * Night: trim reads as stitch/edge glow, not a second light rig.
 */
export function cabinGlowScale(
  night: number,
  headlightsOn: boolean,
  breathe: number
): number {
  const n = Math.max(0, Math.min(1, night));
  return 0.07 + n * 1.05 + (headlightsOn ? n * 0.12 : 0) + breathe;
}

export function cabinFillTargets(input: CabinRampInput): CabinFillTargets {
  const night = Math.max(0, Math.min(1, input.effectiveNight));
  const day = 1 - night;
  const rain = Math.max(0, Math.min(1, input.rain));
  const direct = 1 - rain * 0.75;
  const diffuse = 1 - rain * 0.3;
  const clinical = input.clinical ? 1.35 : 1;

  const hemi = (0.16 * day * clinical + 0.008 * night) * diffuse;
  const ambient = (0.035 * day * clinical + 0.002 * night) * diffuse;
  const overhead = 0.2 * day * direct * clinical;
  const leftWindow = (0.13 * day * clinical + 0.008 * night) * diffuse;
  const rightWindow = (0.09 * day * clinical + 0.006 * night) * diffuse;

  // Headlights: a little dash bounce, not a cabin flood. Rain adds bounce
  // (wet road scatter) instead of extra ambient.
  const bounce =
    (input.headlightsOn ? night * 0.2 : 0) +
    rain * 0.1 * (0.3 + day * 0.7);
  const dash =
    night * 0.22 +
    (input.headlightsOn ? night * 0.1 : 0) +
    (input.domeLightOn ? 0.04 : 0);
  const dome = input.domeLightOn ? 0.92 : 0;
  const headlights = input.headlightsOn ? 0.2 : 0;

  return {
    hemi,
    ambient,
    overhead,
    leftWindow,
    rightWindow,
    bounce,
    dash,
    dome,
    headlights,
  };
}

export function cabinEmitterTargets(input: CabinRampInput): CabinEmitterTargets {
  const night = Math.max(0, Math.min(1, input.effectiveNight));
  const hl = input.headlightsOn ? night * 0.08 : 0;

  return {
    // Screens stay readable by day; cluster is the brightest cabin object at night.
    cluster: 0.2 + night * 0.72 + hl,
    centerDisplay: 0.24 + night * 0.42 + hl * 0.5,
    clock: 0.28 + night * 0.48,
    domeFixture: input.domeLightOn ? 1.55 : 0.015,
    domeSwitch: input.domeLightOn ? 0.45 : 0,
  };
}

export function clusterGlowLevel(input: CabinRampInput): number {
  const night = Math.max(0, Math.min(1, input.effectiveNight));
  return night * 0.85 + (input.headlightsOn ? night * 0.1 : 0);
}

export function domeGlowLevel(input: CabinRampInput): number {
  return input.domeLightOn ? 0.7 + input.effectiveNight * 0.25 : 0;
}

export interface GaugeGlowInput {
  /** 0 = full day, 1 = full night (max of preset + sun altitude). */
  effectiveNight: number;
  headlightsOn: boolean;
  /** 0-1 tacho fraction: revs lift the dial wash and the needle tip. */
  rpmFrac: number;
  /** 0-1 ambient breathing phase; 0 under reduced motion. */
  breathe: number;
}

/**
 * Dial-face backlight (drives the gauge `emissiveMap`).
 * Day floor is deliberately low — the dial well is shaded, so the face should
 * read by IBL, not by a green wash that survives full sun. The headlight bump
 * matches the rest of the rig: instrument backlighting comes up with the lamps.
 */
export function gaugeDialGlow(input: GaugeGlowInput): number {
  const night = Math.max(0, Math.min(1, input.effectiveNight));
  const rpm = Math.max(0, Math.min(1, input.rpmFrac));
  return (
    0.08 +
    night * 0.62 +
    (input.headlightsOn ? night * 0.1 : 0) +
    input.breathe * 0.04 +
    rpm * 0.06
  );
}

/**
 * Needle emissive. Needles are painted metal with a lit tip — by day they
 * should catch highlights rather than emit, at night they are the sharpest
 * thing in the cluster.
 */
export function gaugeNeedleGlow(input: GaugeGlowInput): number {
  const night = Math.max(0, Math.min(1, input.effectiveNight));
  const rpm = Math.max(0, Math.min(1, input.rpmFrac));
  return (
    0.14 +
    night * 0.72 +
    (input.headlightsOn ? night * 0.12 : 0) +
    input.breathe * 0.05 +
    rpm * 0.18
  );
}
