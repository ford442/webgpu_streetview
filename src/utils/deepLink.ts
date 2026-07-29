export interface DeepLinkParams {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  zoom: number;
  panoId?: string;
}

const PARAM_KEYS = {
  lat: 'lat',
  lng: 'lng',
  heading: 'heading',
  pitch: 'pitch',
  zoom: 'zoom',
  panoId: 'pano',
} as const;

/** Builds a shareable URL encoding the view (lat/lng/heading/pitch/zoom/panoId) as query params. */
export function buildDeepLinkUrl(params: DeepLinkParams, base: string = window.location.href): string {
  const url = new URL(base);
  url.searchParams.set(PARAM_KEYS.lat, params.lat.toFixed(6));
  url.searchParams.set(PARAM_KEYS.lng, params.lng.toFixed(6));
  url.searchParams.set(PARAM_KEYS.heading, params.heading.toFixed(1));
  url.searchParams.set(PARAM_KEYS.pitch, params.pitch.toFixed(1));
  url.searchParams.set(PARAM_KEYS.zoom, params.zoom.toFixed(2));
  if (params.panoId) {
    url.searchParams.set(PARAM_KEYS.panoId, params.panoId);
  } else {
    url.searchParams.delete(PARAM_KEYS.panoId);
  }
  return url.toString();
}

/** Parses `?lat=&lng=&heading=&pitch=&zoom=&pano=` from a query string. Returns null if lat/lng are missing/invalid. */
export function parseDeepLinkParams(search: string = window.location.search): DeepLinkParams | null {
  const params = new URLSearchParams(search);
  const lat = parseFloat(params.get(PARAM_KEYS.lat) ?? '');
  const lng = parseFloat(params.get(PARAM_KEYS.lng) ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const headingRaw = parseFloat(params.get(PARAM_KEYS.heading) ?? '0');
  const pitchRaw = parseFloat(params.get(PARAM_KEYS.pitch) ?? '0');
  const zoomRaw = parseFloat(params.get(PARAM_KEYS.zoom) ?? '1');
  const panoId = params.get(PARAM_KEYS.panoId) || undefined;

  return {
    lat,
    lng,
    heading: Number.isFinite(headingRaw) ? headingRaw : 0,
    pitch: Number.isFinite(pitchRaw) ? pitchRaw : 0,
    zoom: Number.isFinite(zoomRaw) ? zoomRaw : 1,
    panoId,
  };
}
