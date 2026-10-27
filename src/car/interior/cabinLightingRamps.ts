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
  /**
   * -1…1 lateral sun position in the car's frame (`sunSideFromBearing`):
   * +1 = sun low off the passenger (right) window, -1 = low off the driver's
   * window, 0 = overhead, dead ahead/behind, or below the horizon. Shifts the
   * day window fill toward the sun side so the cabin reads as lit from one
   * window. Omitted = balanced.
   */
  sunSide?: number;
}

/**
 * Lateral sun component in the car's frame. `bearingRad` is the car-relative
 * sun bearing (0 = ahead, +π/2 = right); the horizontal x-component is
 * `sin(bearing) · cos(altitude)`, weighted by a second `cos(altitude)` so a
 * high sun pours through the windscreen/roofline evenly while a low sun
 * (golden hour) lands on one side. Below the horizon there is no direct sun
 * to take a side.
 */
export function sunSideFromBearing(bearingRad: number, altitudeRad: number): number {
  if (altitudeRad <= 0) return 0;
  const cosAlt = Math.cos(altitudeRad);
  const side = Math.sin(bearingRad) * cosAlt * cosAlt;
  return Math.max(-1, Math.min(1, side));
}

/**
 * Left/right multipliers for the day window fills. They average to 1 so the
 * total daylight entering the cabin does not change with heading — it just
 * moves to the sun side. Rain/overcast diffuses the skylight and flattens
 * the split back toward even.
 */
export function windowFillBalance(sunSide: number, rain: number): { left: number; right: number } {
  const side = Math.max(-1, Math.min(1, sunSide));
  const r = Math.max(0, Math.min(1, rain));
  const split = side * 0.6 * (1 - r);
  return { left: 1 - split, right: 1 + split };
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

/**
 * Emitter colours. Intensities live in the ramps below; these are the
 * colours those intensities multiply.
 *
 * Content maps (dials, clock, location panel) must emit white. Three.js
 * does `emissive * emissiveMap`, so a dark or accent tint crushes the
 * painted glyphs — the old dial well (`0x002211`) left the cluster dark
 * while the backplate carried a flat accent slab.
 */
export const CONTENT_MAP_EMISSIVE = 0xffffff;

/** Recess behind the dials. Dark enough that the cluster ramp cannot turn it into a slab. */
export const CLUSTER_WELL_EMISSIVE = 0x10120e;

/** Housing behind the infotainment screen. The live screen is the emitter. */
export const DISPLAY_HOUSING_EMISSIVE = 0x0e1012;

/**
 * Dash point-light spill. Warm instrument bounce, not `accentColor`:
 * a green point light paints the wheel and the leather.
 */
export const DASH_SPILL_COLOR = 0xffe6c2;

/** Daytime sun directional intensity before weather attenuation. */
export function sunBaseIntensityFromStrength(strength: number): number {
  return strength * 1.55;
}

/** Preset night must dim the real sun too, even when SunCalc still reports daylight. */
export function sunIntensityUnderWeather(base: number, rain: number, effectiveNight: number): number {
  const day = 1 - Math.max(0, Math.min(1, effectiveNight));
  return base * (1 - Math.max(0, Math.min(1, rain)) * 0.75) * day;
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

  // Day fill is a soft base. The sun directional (up to ~1.55) and the pano
  // IBL are what model leather and the dash; a stronger hemi/overhead pair
  // flattens them into grey plastic.
  const hemi = (0.12 * day * clinical + 0.008 * night) * diffuse;
  const ambient = (0.022 * day * clinical + 0.002 * night) * diffuse;
  const overhead = 0.09 * day * direct * clinical;
  // Window fills: the day term follows the sun side (a low sun off the
  // driver's window lights the driver's side), the night term is a flat
  // streetlight hint. The driver-side bias in the base values stays.
  const balance = windowFillBalance(input.sunSide ?? 0, rain);
  const leftWindow = (0.1 * day * clinical * balance.left + 0.008 * night) * diffuse;
  const rightWindow = (0.07 * day * clinical * balance.right + 0.006 * night) * diffuse;

  // Headlights: a little dash bounce, not a cabin flood. Rain adds bounce
  // (wet road scatter) instead of extra ambient.
  const bounce =
    (input.headlightsOn ? night * 0.14 : 0) +
    rain * 0.1 * (0.3 + day * 0.7);
  // The spill sits ~0.4 m off the dash face, so it lands as a patch above the
  // cluster. At the old 0.22 + 0.1 that patch out-shone the cluster at night;
  // half that keeps it a glow around the instruments.
  const dash =
    night * 0.11 +
    (input.headlightsOn ? night * 0.05 : 0) +
    (input.domeLightOn ? 0.02 : 0);
  const dome = input.domeLightOn ? 1.3 : 0;
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
    // Cluster backplate: the dark well the dials sit in. It glows only enough
    // to separate the well from the dash; the dials (gaugeDialGlow) carry the
    // light, or the whole cluster reads as one flat neon slab at night.
    cluster: 0.03 + night * 0.09 + hl * 0.5,
    centerDisplay: 0.24 + night * 0.42 + hl * 0.5,
    clock: 0.28 + night * 0.48,
    // Fixture emissive 0xffe8b0. Above ~0.9 the red channel clips under
    // NoToneMapping and the disc goes white; 0.85 stays a warm diffuser.
    // The point light is on another layer so it cannot blast this mesh.
    domeFixture: input.domeLightOn ? 0.85 : 0.015,
    domeSwitch: input.domeLightOn ? 0.45 : 0,
  };
}

export function clusterGlowLevel(input: CabinRampInput): number {
  const night = Math.max(0, Math.min(1, input.effectiveNight));
  // The halo quad spans the whole cluster well, so any real strength floods
  // it into one flat slab (measured: it was the well's largest contributor).
  // Keep it a faint lift; ticks, numerals and needles carry the cluster.
  return night * 0.1 + (input.headlightsOn ? night * 0.02 : 0);
}

/**
 * Additive halo around the dome disc. Night-weighted: by day the fixture
 * mesh itself reads as "on", and a full halo against a sunlit headliner
 * looks like a sticker, so keep it a faint hint until the sun is down.
 */
export function domeGlowLevel(input: CabinRampInput): number {
  if (!input.domeLightOn) return 0;
  const night = Math.max(0, Math.min(1, input.effectiveNight));
  return 0.12 + night * 0.83;
}

/**
 * Infotainment screen glow (CenterDisplay.setNightGlow).
 * Matches the `centerDisplay` emitter ramp above so the live screen and the
 * dash placeholder behind it agree at every night factor: readable by day,
 * brightest cabin object family at night without blooming.
 */
export function centerDisplayGlowFromNight(night: number): number {
  return 0.24 + Math.max(0, Math.min(1, night)) * 0.42;
}

/**
 * VFD location-panel glow (LocationPanel.setNightGlow).
 * Hotter baseline than the infotainment screen so the road name stays
 * legible in daylight; same clamping contract.
 */
export function locationPanelGlowFromNight(night: number): number {
  return 0.6 + Math.max(0, Math.min(1, night)) * 0.6;
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
