/**
 * Parse destination-bar input without hitting Places.
 * Coordinate paste and panorama ids resolve locally; everything else is text.
 */

export type ParsedSearchQuery =
  | { kind: 'empty' }
  | { kind: 'coordinates'; lat: number; lng: number }
  | { kind: 'pano'; panoId: string }
  | { kind: 'text'; query: string };

const COORD_RE =
  /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** Street View pano ids are opaque tokens, typically 22+ URL-safe chars. */
const PANO_ID_RE = /^(?:pano:)?([A-Za-z0-9_-]{22,})$/;

function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const query = raw.trim();
  if (!query) return { kind: 'empty' };

  try {
    const url = new URL(query);
    const lat = parseFloat(url.searchParams.get('lat') ?? '');
    const lng = parseFloat(url.searchParams.get('lng') ?? '');
    const pano = url.searchParams.get('pano')?.trim();
    if (pano) return { kind: 'pano', panoId: pano };
    if (isValidLatLng(lat, lng)) return { kind: 'coordinates', lat, lng };
  } catch {
    /* not a URL */
  }

  const coords = query.match(COORD_RE);
  if (coords) {
    const lat = parseFloat(coords[1]!);
    const lng = parseFloat(coords[2]!);
    if (isValidLatLng(lat, lng)) return { kind: 'coordinates', lat, lng };
  }

  const panoMatch = query.match(PANO_ID_RE);
  if (panoMatch) {
    return { kind: 'pano', panoId: panoMatch[1]! };
  }

  return { kind: 'text', query };
}
