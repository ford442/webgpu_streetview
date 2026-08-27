/**
 * studioLink.ts — shareable film-set URL params composed with location + look.
 *
 * Location keys stay in deepLink.ts; look keys stay in lookLink.ts.
 *
 *   ?pano=...&look=noir&year=2012&vehicle=convertible
 */

import { buildDeepLinkUrl, parseDeepLinkParams, type DeepLinkParams } from './deepLink';
import { LOOK_PARAM_KEYS, applyLookSearchParams } from './lookLink';
import { isLookId, type LookId } from '../config/lookPacks';
import { isValidVehicleType, type VehicleType } from '../car/VehicleManager';

export const STUDIO_PARAM_KEYS = {
  year: 'year',
  vehicle: 'vehicle',
} as const;

export interface StudioLinkParams extends DeepLinkParams {
  lookId?: LookId;
  year?: string;
  vehicleType?: VehicleType;
}

export interface StudioShareInput {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  zoom: number;
  panoId?: string;
  lookId?: string | null;
  year?: string | null;
  vehicleType?: string | null;
}

function parseYear(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const match = /^(\d{4})(?:-\d{2})?$/.exec(raw.trim());
  return match?.[1];
}

/** Parse `year` + `vehicle` (and named `look` if present) from a query string. */
export function parseStudioLinkParams(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): Pick<StudioLinkParams, 'lookId' | 'year' | 'vehicleType'> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const lookRaw = params.get(LOOK_PARAM_KEYS.look);
  const vehicleRaw = params.get(STUDIO_PARAM_KEYS.vehicle);
  return {
    lookId: lookRaw && isLookId(lookRaw) ? lookRaw : undefined,
    year: parseYear(params.get(STUDIO_PARAM_KEYS.year)),
    vehicleType: vehicleRaw && isValidVehicleType(vehicleRaw) ? vehicleRaw : undefined,
  };
}

export function readBootStudio(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): Pick<StudioLinkParams, 'lookId' | 'year' | 'vehicleType'> {
  try {
    return parseStudioLinkParams(search);
  } catch {
    return {};
  }
}

/**
 * Location deep link plus optional look / year / vehicle.
 * Unknown look or vehicle ids are omitted (same policy as session v2).
 */
export function buildStudioShareUrl(
  input: StudioShareInput,
  base: string = typeof window !== 'undefined' ? window.location.href : 'https://example.com/',
): string {
  const locationUrl = buildDeepLinkUrl(
    {
      lat: input.lat,
      lng: input.lng,
      heading: input.heading,
      pitch: input.pitch,
      zoom: input.zoom,
      panoId: input.panoId,
    },
    base,
  );
  const url = new URL(locationUrl);
  if (input.lookId && isLookId(input.lookId)) {
    applyLookSearchParams(url, { look: input.lookId });
  }
  const year = parseYear(input.year ?? null);
  if (year) url.searchParams.set(STUDIO_PARAM_KEYS.year, year);
  else url.searchParams.delete(STUDIO_PARAM_KEYS.year);
  if (input.vehicleType && isValidVehicleType(input.vehicleType)) {
    url.searchParams.set(STUDIO_PARAM_KEYS.vehicle, input.vehicleType);
  } else {
    url.searchParams.delete(STUDIO_PARAM_KEYS.vehicle);
  }
  return url.toString();
}

export function yearFromImageDate(imageDate: string | null | undefined): string | undefined {
  const match = /^(\d{4})/.exec(imageDate ?? '');
  return match?.[1];
}

/** Re-export for callers that also consume location params in one place. */
export { parseDeepLinkParams };
