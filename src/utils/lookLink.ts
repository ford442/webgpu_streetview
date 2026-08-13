/**
 * lookLink.ts — shareable look / scene-pack URL params.
 *
 * Lives beside location deep links (`deepLink.ts`). Location keys
 * (lat/lng/heading/pitch/zoom/pano) are never overwritten here.
 *
 *   ?look=noir
 *   ?look=noir&rain=40
 *   ?tod=night&sat=0.4&con=1.5   (custom, no named look)
 */

import {
  LOOK_PACKS,
  diffLookOverrides,
  getLookPack,
  isLookId,
  resolveLookEnv,
  type LookEnvPatch,
  type LookEnvSnapshot,
  type LookId,
} from '../config/lookPacks';
import type { LookTimeOfDay } from '../config/lookPacks';

export const LOOK_PARAM_KEYS = {
  look: 'look',
  rain: 'rain',
  snow: 'snow',
  wind: 'wind',
  fog: 'fog',
  tod: 'tod',
  vibrance: 'vib',
  saturation: 'sat',
  contrast: 'con',
  exposure: 'exp',
  temperature: 'temp',
  tint: 'tint',
  night: 'night',
  headlights: 'hl',
  highBeam: 'beam',
  dome: 'dome',
  wipers: 'wipers',
} as const;

const TIME_OF_DAY: readonly LookTimeOfDay[] = ['day', 'sunrise', 'sunset', 'night'];

export interface LookUrlParams {
  look?: LookId;
  rain?: number;
  snow?: number;
  wind?: number;
  fog?: number;
  tod?: LookTimeOfDay;
  vibrance?: number;
  saturation?: number;
  contrast?: number;
  exposure?: number;
  temperature?: number;
  tint?: number;
  night?: number;
  headlights?: boolean;
  highBeam?: boolean;
  dome?: boolean;
  wipers?: boolean;
}

const LOOK_SEARCH_KEYS = new Set<string>(Object.values(LOOK_PARAM_KEYS));

function parseFinite(raw: string | null): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseBool(raw: string | null): boolean | undefined {
  if (raw == null || raw === '') return undefined;
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return undefined;
}

function formatGrade(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m));
}

function formatBool(v: boolean): string {
  return v ? '1' : '0';
}

export function parseLookParams(search: string = ''): LookUrlParams {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const lookRaw = params.get(LOOK_PARAM_KEYS.look);
  const todRaw = params.get(LOOK_PARAM_KEYS.tod);

  const rain = parseFinite(params.get(LOOK_PARAM_KEYS.rain));
  const snow = parseFinite(params.get(LOOK_PARAM_KEYS.snow));
  const wind = parseFinite(params.get(LOOK_PARAM_KEYS.wind));
  const fog = parseFinite(params.get(LOOK_PARAM_KEYS.fog));
  const vibrance = parseFinite(params.get(LOOK_PARAM_KEYS.vibrance));
  const saturation = parseFinite(params.get(LOOK_PARAM_KEYS.saturation));
  const contrast = parseFinite(params.get(LOOK_PARAM_KEYS.contrast));
  const exposure = parseFinite(params.get(LOOK_PARAM_KEYS.exposure));
  const temperature = parseFinite(params.get(LOOK_PARAM_KEYS.temperature));
  const tint = parseFinite(params.get(LOOK_PARAM_KEYS.tint));
  const night = parseFinite(params.get(LOOK_PARAM_KEYS.night));

  const parsed: LookUrlParams = {};
  if (isLookId(lookRaw)) parsed.look = lookRaw;
  if (todRaw && (TIME_OF_DAY as readonly string[]).includes(todRaw)) {
    parsed.tod = todRaw as LookTimeOfDay;
  }
  if (rain !== undefined) parsed.rain = clamp(rain, 0, 100);
  if (snow !== undefined) parsed.snow = clamp(snow, 0, 100);
  if (wind !== undefined) parsed.wind = clamp(wind, -100, 100);
  if (fog !== undefined) parsed.fog = clamp(fog, 0, 100);
  if (vibrance !== undefined) parsed.vibrance = clamp(vibrance, 0, 2);
  if (saturation !== undefined) parsed.saturation = clamp(saturation, 0, 2);
  if (contrast !== undefined) parsed.contrast = clamp(contrast, 0.5, 2);
  if (exposure !== undefined) parsed.exposure = clamp(exposure, -2, 2);
  if (temperature !== undefined) parsed.temperature = clamp(temperature, -1, 1);
  if (tint !== undefined) parsed.tint = clamp(tint, -1, 1);
  if (night !== undefined) parsed.night = clamp(night, 0, 1);

  const headlights = parseBool(params.get(LOOK_PARAM_KEYS.headlights));
  const highBeam = parseBool(params.get(LOOK_PARAM_KEYS.highBeam));
  const dome = parseBool(params.get(LOOK_PARAM_KEYS.dome));
  const wipers = parseBool(params.get(LOOK_PARAM_KEYS.wipers));
  if (headlights !== undefined) parsed.headlights = headlights;
  if (highBeam !== undefined) parsed.highBeam = highBeam;
  if (dome !== undefined) parsed.dome = dome;
  if (wipers !== undefined) parsed.wipers = wipers;

  return parsed;
}

/** True when the query string carries at least one look / weather / grade key. */
export function hasLookSearchParams(search: string = ''): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const key of params.keys()) {
    if (LOOK_SEARCH_KEYS.has(key)) return true;
  }
  return false;
}

export function lookUrlToOverrides(parsed: LookUrlParams): Partial<LookEnvPatch> {
  const o: Partial<LookEnvPatch> = {};
  if (parsed.tod) o.timeOfDay = parsed.tod;
  if (parsed.rain !== undefined) o.rainIntensity = parsed.rain;
  if (parsed.snow !== undefined) o.snowIntensity = parsed.snow;
  if (parsed.wind !== undefined) o.wind = parsed.wind;
  if (parsed.fog !== undefined) o.fogDensity = parsed.fog;
  if (parsed.vibrance !== undefined) o.vibrance = parsed.vibrance;
  if (parsed.saturation !== undefined) o.saturation = parsed.saturation;
  if (parsed.contrast !== undefined) o.contrast = parsed.contrast;
  if (parsed.exposure !== undefined) o.exposure = parsed.exposure;
  if (parsed.temperature !== undefined) o.temperature = parsed.temperature;
  if (parsed.tint !== undefined) o.tint = parsed.tint;
  if (parsed.night !== undefined) o.nightIntensity = parsed.night;
  if (parsed.headlights !== undefined) o.headlightsOn = parsed.headlights;
  if (parsed.highBeam !== undefined) o.highBeam = parsed.highBeam;
  if (parsed.dome !== undefined) o.domeLightOn = parsed.dome;
  if (parsed.wipers !== undefined) o.wipersEnabled = parsed.wipers;
  return o;
}

export interface ResolvedLookBoot {
  lookId: LookId | null;
  patch: LookEnvPatch;
}

/**
 * Named look (if any) plus overrides. Missing look + no overrides → null
 * so the provider keeps its built-in defaults.
 */
export function resolveLookSearch(search: string = ''): ResolvedLookBoot | null {
  if (!hasLookSearchParams(search)) return null;
  const parsed = parseLookParams(search);
  const pack = getLookPack(parsed.look ?? null);
  const overrides = lookUrlToOverrides(parsed);
  if (!pack && Object.keys(overrides).length === 0) return null;
  return {
    lookId: pack ? pack.id : null,
    patch: resolveLookEnv(pack, overrides),
  };
}

function setOrDelete(url: URL, key: string, value: string | undefined): void {
  if (value === undefined) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
}

/** Write look keys onto a URL, preserving location / renderer flags. */
export function applyLookSearchParams(url: URL, params: LookUrlParams): void {
  const K = LOOK_PARAM_KEYS;
  setOrDelete(url, K.look, params.look);
  setOrDelete(url, K.rain, params.rain !== undefined ? String(Math.round(params.rain)) : undefined);
  setOrDelete(url, K.snow, params.snow !== undefined ? String(Math.round(params.snow)) : undefined);
  setOrDelete(url, K.wind, params.wind !== undefined ? String(Math.round(params.wind)) : undefined);
  setOrDelete(url, K.fog, params.fog !== undefined ? String(Math.round(params.fog)) : undefined);
  setOrDelete(url, K.tod, params.tod);
  setOrDelete(url, K.vibrance, params.vibrance !== undefined ? formatGrade(params.vibrance) : undefined);
  setOrDelete(url, K.saturation, params.saturation !== undefined ? formatGrade(params.saturation) : undefined);
  setOrDelete(url, K.contrast, params.contrast !== undefined ? formatGrade(params.contrast) : undefined);
  setOrDelete(url, K.exposure, params.exposure !== undefined ? formatGrade(params.exposure) : undefined);
  setOrDelete(url, K.temperature, params.temperature !== undefined ? formatGrade(params.temperature) : undefined);
  setOrDelete(url, K.tint, params.tint !== undefined ? formatGrade(params.tint) : undefined);
  setOrDelete(url, K.night, params.night !== undefined ? formatGrade(params.night) : undefined);
  setOrDelete(url, K.headlights, params.headlights !== undefined ? formatBool(params.headlights) : undefined);
  setOrDelete(url, K.highBeam, params.highBeam !== undefined ? formatBool(params.highBeam) : undefined);
  setOrDelete(url, K.dome, params.dome !== undefined ? formatBool(params.dome) : undefined);
  setOrDelete(url, K.wipers, params.wipers !== undefined ? formatBool(params.wipers) : undefined);
}

function overridesToUrlParams(o: Partial<LookEnvPatch>): LookUrlParams {
  const p: LookUrlParams = {};
  if (o.timeOfDay) p.tod = o.timeOfDay;
  if (o.rainIntensity !== undefined) p.rain = o.rainIntensity;
  if (o.snowIntensity !== undefined) p.snow = o.snowIntensity;
  if (o.wind !== undefined) p.wind = o.wind;
  if (o.fogDensity !== undefined) p.fog = o.fogDensity;
  if (o.vibrance !== undefined) p.vibrance = o.vibrance;
  if (o.saturation !== undefined) p.saturation = o.saturation;
  if (o.contrast !== undefined) p.contrast = o.contrast;
  if (o.exposure !== undefined) p.exposure = o.exposure;
  if (o.temperature !== undefined) p.temperature = o.temperature;
  if (o.tint !== undefined) p.tint = o.tint;
  if (o.nightIntensity !== undefined) p.night = o.nightIntensity;
  if (o.headlightsOn !== undefined) p.headlights = o.headlightsOn;
  if (o.highBeam !== undefined) p.highBeam = o.highBeam;
  if (o.domeLightOn !== undefined) p.dome = o.domeLightOn;
  if (o.wipersEnabled !== undefined) p.wipers = o.wipersEnabled;
  return p;
}

export interface BuildLookUrlInput {
  lookId?: LookId | null;
  state: LookEnvSnapshot;
}

/**
 * Encode the current look. If `lookId` matches a pack, emit `?look=id` plus
 * only the sliders that differ. Otherwise emit a full custom param set.
 */
export function lookStateToUrlParams(input: BuildLookUrlInput): LookUrlParams {
  const pack = getLookPack(input.lookId ?? null);
  if (pack) {
    return { look: pack.id, ...overridesToUrlParams(diffLookOverrides(pack, input.state)) };
  }
  // Custom grade/weather: emit only diffs from the Clear defaults so a dry
  // daylight scene produces an empty look query.
  return overridesToUrlParams(diffLookOverrides(LOOK_PACKS.clear, input.state));
}

export function buildLookUrl(
  input: BuildLookUrlInput,
  base: string = typeof window !== 'undefined' ? window.location.href : 'https://example.com/',
): string {
  const url = new URL(base);
  // Clear previous look keys so a shorter `?look=noir` doesn't leave stale rain=.
  for (const key of LOOK_SEARCH_KEYS) url.searchParams.delete(key);
  applyLookSearchParams(url, lookStateToUrlParams(input));
  return url.toString();
}

/** Semantic round-trip: parse(build(state)) resolves to the same env patch. */
export function resolveLookUrlParams(params: LookUrlParams): LookEnvPatch {
  const pack = getLookPack(params.look ?? null);
  return resolveLookEnv(pack, lookUrlToOverrides(params));
}

/** Safe window.location boot helper (SSR / vitest: no throw). */
export function readBootLook(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): ResolvedLookBoot | null {
  try {
    return resolveLookSearch(search);
  } catch {
    return null;
  }
}
