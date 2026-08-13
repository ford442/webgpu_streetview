/**
 * lookPacks.ts — named artistic looks + scene packs.
 *
 * Each pack is a one-click combination of weather, time-of-day, vehicle lights,
 * and color-grading knobs. Grading is the existing 6-slider chain
 * (vibrance → saturation → contrast → temperature/tint → exposure) with ACES
 * still last in the shader — "LUTs as piecewise curves" without a 3D LUT
 * texture or extra uniform slots. The 40-float weather layout is unchanged.
 *
 * Look targets and before/after notes: docs/looks/README.md, docs/GRAPHICS.md §8.
 */

/** Mirrors `TimeOfDay` in useEnvironmentSettings — kept local to avoid a cycle. */
export type LookTimeOfDay = 'day' | 'sunrise' | 'sunset' | 'night';

export type LookId =
  | 'clear'
  | 'noir'
  | 'teal-orange'
  | 'bleach-bypass'
  | 'golden-hour'
  | 'storm'
  | 'arctic'
  | 'neon-rain';

/** Three-stop luminance/color curve approximated by the 6 grading uniforms. */
export interface LookCurveNotes {
  /** 0–1 luma target in the shadows, plus a short color note. */
  shadows: string;
  mids: string;
  highlights: string;
}

export interface LookPack {
  id: LookId;
  name: string;
  emoji: string;
  /** One-line panel blurb. */
  tagline: string;
  description: string;
  before: string;
  after: string;
  curve: LookCurveNotes;
  timeOfDay: LookTimeOfDay;
  /** UI 0–100 (WeatherPanel). */
  rain: number;
  snow: number;
  /** UI −100..100 (WeatherPanel). 0 = calm. */
  wind: number;
  fog: number;
  vibrance: number;
  saturation: number;
  contrast: number;
  exposure: number;
  temperature: number;
  tint: number;
  /** Optional night slider override (0–1). Omit to use the TOD preset's value. */
  nightIntensity?: number;
  headlights?: boolean;
  highBeam?: boolean;
  domeLight?: boolean;
  wipers?: boolean;
}

export const LOOK_IDS: readonly LookId[] = [
  'clear',
  'noir',
  'teal-orange',
  'bleach-bypass',
  'golden-hour',
  'storm',
  'arctic',
  'neon-rain',
] as const;

export const LOOK_PACKS: Record<LookId, LookPack> = {
  clear: {
    id: 'clear',
    name: 'Clear',
    emoji: '☀️',
    tagline: 'Untouched daylight',
    description: 'Neutral grading, no weather, sun FX at full strength. The reset / before state.',
    before: 'Whatever look was on — rain, night, split-tone, etc.',
    after: 'Stock Street View color, clear sky, shafts/flare at the cohesion floor (no haze to scatter in).',
    curve: {
      shadows: 'untouched (contrast 1.0, exposure 0)',
      mids: 'neutral vibrance/sat 1.0',
      highlights: 'ACES only — no lift',
    },
    timeOfDay: 'day',
    rain: 0,
    snow: 0,
    wind: 0,
    fog: 0,
    vibrance: 1.0,
    saturation: 1.0,
    contrast: 1.0,
    exposure: 0.0,
    temperature: 0.0,
    tint: 0.0,
    nightIntensity: 0,
    headlights: false,
    highBeam: false,
    domeLight: false,
    wipers: false,
  },
  noir: {
    id: 'noir',
    name: 'Noir',
    emoji: '🎬',
    tagline: 'Ink-black night, wet streets',
    description:
      'High-contrast desaturation, cool temperature, light rain and ground mist. Headlights pool on the road; the #171 night floor keeps it readable.',
    before: 'Daylight panorama, Google-saturated signs, flat exposure.',
    after: 'Silver pavement, crushed sky, sparse rain, headlight pools. Color almost gone except cool street lamps.',
    curve: {
      shadows: 'crushed toward cool blue (temp −0.45, tint +0.15, exposure −0.25)',
      mids: 'thin, desaturated (sat 0.35, vibrance 0.45)',
      highlights: 'hard specular from headlights (contrast 1.55) then ACES',
    },
    timeOfDay: 'night',
    rain: 25,
    snow: 0,
    wind: 12,
    fog: 18,
    vibrance: 0.45,
    saturation: 0.35,
    contrast: 1.55,
    exposure: -0.25,
    temperature: -0.45,
    tint: 0.15,
    nightIntensity: 1.0,
    headlights: true,
    highBeam: false,
    domeLight: false,
    wipers: true,
  },
  'teal-orange': {
    id: 'teal-orange',
    name: 'Teal & Orange',
    emoji: '🧡',
    tagline: 'Travel-poster split tone',
    description:
      'Sunset TOD plus a complementary grade: warm highlights (temperature+) against teal shadows (tint−). Thin haze for postcard depth.',
    before: 'Generic afternoon Street View — mixed white balance, no sky drama.',
    after: 'Sun side reads honey/orange; shade and asphalt pick up teal. Horizon glow agrees with camera heading.',
    curve: {
      shadows: 'teal push (tint −0.28, slight cool in unlit areas)',
      mids: 'lifted vibrance 1.35 / sat 1.25',
      highlights: 'orange sun (temp +0.42, exposure +0.12) then ACES',
    },
    timeOfDay: 'sunset',
    rain: 0,
    snow: 0,
    wind: 8,
    fog: 8,
    vibrance: 1.35,
    saturation: 1.25,
    contrast: 1.18,
    exposure: 0.12,
    temperature: 0.42,
    tint: -0.28,
    headlights: false,
    wipers: false,
  },
  'bleach-bypass': {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    emoji: '📰',
    tagline: 'Silver-retention newsreel',
    description:
      'Skip-bleach: retain silver (high contrast, low saturation) with a touch of overexposure. Light fog stands in for overcast so cohesion kills the sun.',
    before: 'Colorful storefronts and sky, soft Google contrast.',
    after: 'Harsh metallic mids, retained highlight texture, almost no chroma. Sky goes newsreel grey.',
    curve: {
      shadows: 'hard floor (contrast 1.65) with almost no chroma',
      mids: 'desat 0.50 / vibrance 0.55 — silver retention',
      highlights: 'slight overexposure (+0.15) compressed by ACES, not clipped',
    },
    timeOfDay: 'day',
    rain: 0,
    snow: 0,
    wind: 0,
    fog: 22,
    vibrance: 0.55,
    saturation: 0.5,
    contrast: 1.65,
    exposure: 0.15,
    temperature: -0.05,
    tint: 0.0,
    nightIntensity: 0.05,
    headlights: false,
    wipers: false,
  },
  'golden-hour': {
    id: 'golden-hour',
    name: 'Golden Hour',
    emoji: '🌅',
    tagline: 'Honey light, long warmth',
    description:
      'Sunrise TOD (sun just up, camera-aware wash) with warm temperature and a soft haze band. The travel-poster cousin of teal-orange, without the complementary split.',
    before: 'Default day — white sun, no atmosphere.',
    after: 'Honey low sun on the tracked azimuth, soft far-field haze, lifted exposure.',
    curve: {
      shadows: 'warm lift, not crushed (exposure +0.18)',
      mids: 'vibrance 1.25 / sat 1.15',
      highlights: 'temp +0.48 rolling into ACES rolloff',
    },
    timeOfDay: 'sunrise',
    rain: 0,
    snow: 0,
    wind: 5,
    fog: 6,
    vibrance: 1.25,
    saturation: 1.15,
    contrast: 1.08,
    exposure: 0.18,
    temperature: 0.48,
    tint: -0.18,
    headlights: false,
    wipers: false,
  },
  storm: {
    id: 'storm',
    name: 'Storm',
    emoji: '⛈️',
    tagline: 'Near-black sky, driven rain',
    description:
      'Rain 100 / wind 80 / fog 35 from GRAPHICS.md §3, plus a cool underexposed grade. Overcast kills shafts and flare; rain darken eases at night so the readable floor survives.',
    before: 'Clear noon, lens flare, dusty air.',
    after: 'Sun gone, wet haze, streaks slanted with wind, scene −~26% by day. Wipers on.',
    curve: {
      shadows: 'cool underexpose (temp −0.28, exposure −0.35)',
      mids: 'sat 0.75 / vibrance 0.70 — muted greens',
      highlights: 'specular rain + leftover ACES; no sun FX',
    },
    timeOfDay: 'day',
    rain: 100,
    snow: 0,
    wind: 80,
    fog: 35,
    vibrance: 0.7,
    saturation: 0.75,
    contrast: 1.25,
    exposure: -0.35,
    temperature: -0.28,
    tint: 0.18,
    nightIntensity: 0.22,
    headlights: false,
    wipers: true,
  },
  arctic: {
    id: 'arctic',
    name: 'Arctic',
    emoji: '❄️',
    tagline: 'High-key snow, cold air',
    description:
      'Blizzard-adjacent snow with cool temperature and lifted exposure. Snow adds little humidity (cold air); flakes stay bright and pick up headlights if you later switch to night.',
    before: 'Temperate street, warm pavement, no particles.',
    after: 'High-key snow, cool air, flakes falling downward, far field softened by fog/haze.',
    curve: {
      shadows: 'lifted, slightly cyan (temp −0.22, exposure +0.28)',
      mids: 'sat pulled to 0.82 so snow stays white',
      highlights: 'contrast 1.22 keeps flake edges; ACES holds the blowout',
    },
    timeOfDay: 'day',
    rain: 0,
    snow: 85,
    wind: -40,
    fog: 20,
    vibrance: 1.05,
    saturation: 0.82,
    contrast: 1.22,
    exposure: 0.28,
    temperature: -0.22,
    tint: 0.05,
    headlights: false,
    wipers: false,
  },
  'neon-rain': {
    id: 'neon-rain',
    name: 'Neon Rain',
    emoji: '🌃',
    tagline: 'Wet night, magenta/cyan',
    description:
      'Night rain with a complementary neon grade (cool temperature + magenta tint). Humidity haze and headlights keep the road readable; cinematic extras still gate on reduced-motion.',
    before: 'Stock night — crushed or merely blue-tinted, dry pavement.',
    after: 'Wet asphalt, cyan haze in the distance, magenta bounce, headlight cones, rain streaks downward.',
    curve: {
      shadows: 'cyan-black (temp −0.35, night floor from #171)',
      mids: 'magenta tint +0.35 against remaining chroma',
      highlights: 'headlight warmth vs neon; ACES last',
    },
    timeOfDay: 'night',
    rain: 55,
    snow: 0,
    wind: 25,
    fog: 16,
    vibrance: 1.15,
    saturation: 1.05,
    contrast: 1.28,
    exposure: -0.15,
    temperature: -0.35,
    tint: 0.35,
    nightIntensity: 1.0,
    headlights: true,
    highBeam: true,
    domeLight: false,
    wipers: true,
  },
};

export function isLookId(value: string | null | undefined): value is LookId {
  return typeof value === 'string' && (LOOK_IDS as readonly string[]).includes(value);
}

export function getLookPack(id: string | null | undefined): LookPack | null {
  if (!isLookId(id)) return null;
  return LOOK_PACKS[id];
}

/** Slider/light fields a look writes into EnvironmentSettings. */
export interface LookEnvPatch {
  timeOfDay: LookTimeOfDay;
  rainIntensity: number;
  snowIntensity: number;
  wind: number;
  fogDensity: number;
  vibrance: number;
  saturation: number;
  contrast: number;
  exposure: number;
  temperature: number;
  tint: number;
  nightIntensity: number;
  headlightsOn: boolean;
  highBeam: boolean;
  domeLightOn: boolean;
  wipersEnabled: boolean;
  shaderEffectsEnabled: boolean;
  autoNightMode: boolean;
}

const TOD_NIGHT_INTENSITY: Record<LookTimeOfDay, number> = {
  day: 0,
  sunrise: 0.1,
  sunset: 0.3,
  night: 1,
};

/** Flatten a pack into the environment fields the provider/URL layer consume. */
export function lookPackToEnvPatch(pack: LookPack): LookEnvPatch {
  return {
    timeOfDay: pack.timeOfDay,
    rainIntensity: pack.rain,
    snowIntensity: pack.snow,
    wind: pack.wind,
    fogDensity: pack.fog,
    vibrance: pack.vibrance,
    saturation: pack.saturation,
    contrast: pack.contrast,
    exposure: pack.exposure,
    temperature: pack.temperature,
    tint: pack.tint,
    nightIntensity: pack.nightIntensity ?? TOD_NIGHT_INTENSITY[pack.timeOfDay],
    headlightsOn: pack.headlights === true,
    highBeam: pack.highBeam === true,
    domeLightOn: pack.domeLight === true,
    wipersEnabled: pack.wipers === true,
    shaderEffectsEnabled: true,
    autoNightMode: false,
  };
}

const LOOK_NUMERIC_KEYS = [
  'rainIntensity',
  'snowIntensity',
  'wind',
  'fogDensity',
  'vibrance',
  'saturation',
  'contrast',
  'exposure',
  'temperature',
  'tint',
  'nightIntensity',
] as const;

const LOOK_BOOL_KEYS = [
  'headlightsOn',
  'highBeam',
  'domeLightOn',
  'wipersEnabled',
  'shaderEffectsEnabled',
] as const;

export type LookEnvSnapshot = Pick<
  LookEnvPatch,
  | 'timeOfDay'
  | 'rainIntensity'
  | 'snowIntensity'
  | 'wind'
  | 'fogDensity'
  | 'vibrance'
  | 'saturation'
  | 'contrast'
  | 'exposure'
  | 'temperature'
  | 'tint'
  | 'nightIntensity'
  | 'headlightsOn'
  | 'highBeam'
  | 'domeLightOn'
  | 'wipersEnabled'
  | 'shaderEffectsEnabled'
>;

export function pickLookSnapshot(state: LookEnvSnapshot): LookEnvSnapshot {
  return {
    timeOfDay: state.timeOfDay,
    rainIntensity: state.rainIntensity,
    snowIntensity: state.snowIntensity,
    wind: state.wind,
    fogDensity: state.fogDensity,
    vibrance: state.vibrance,
    saturation: state.saturation,
    contrast: state.contrast,
    exposure: state.exposure,
    temperature: state.temperature,
    tint: state.tint,
    nightIntensity: state.nightIntensity,
    headlightsOn: state.headlightsOn,
    highBeam: state.highBeam,
    domeLightOn: state.domeLightOn,
    wipersEnabled: state.wipersEnabled,
    shaderEffectsEnabled: state.shaderEffectsEnabled,
  };
}

function nearlyEqual(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

/** Fields on `state` that differ from the pack (used as URL overrides). */
export function diffLookOverrides(
  pack: LookPack,
  state: LookEnvSnapshot,
): Partial<LookEnvPatch> {
  const base = lookPackToEnvPatch(pack);
  const out: Partial<LookEnvPatch> = {};
  if (state.timeOfDay !== base.timeOfDay) out.timeOfDay = state.timeOfDay;
  for (const key of LOOK_NUMERIC_KEYS) {
    if (!nearlyEqual(state[key], base[key])) out[key] = state[key];
  }
  for (const key of LOOK_BOOL_KEYS) {
    if (state[key] !== base[key]) out[key] = state[key];
  }
  return out;
}

export function lookPackMatchesState(pack: LookPack, state: LookEnvSnapshot): boolean {
  return Object.keys(diffLookOverrides(pack, state)).length === 0;
}

/** Merge a pack with optional slider/light overrides (URL round-trip). */
export function resolveLookEnv(
  pack: LookPack | null,
  overrides: Partial<LookEnvPatch> = {},
): LookEnvPatch {
  const base = pack
    ? lookPackToEnvPatch(pack)
    : lookPackToEnvPatch(LOOK_PACKS.clear);
  return { ...base, ...overrides, shaderEffectsEnabled: true, autoNightMode: false };
}
