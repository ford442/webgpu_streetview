/**
 * Maps JS Places + Street View coverage helpers.
 * Places library is imported only when the user types a text query or
 * enables nearby POIs — never at boot.
 */

import {
  getPlaceSearchBudget,
  PLACE_SEARCH_DEFAULTS,
  type PlaceSearchBlockReason,
  type PlaceSearchMeter,
} from './placeSearchBudget';
import { isGeocodeDenied, noteGeocodeStatus } from './geocodeAuth';
import {
  NEARBY_CATEGORY_PLACE_TYPES,
  type NearbyPoi,
  type NearbyPoiCategory,
} from './poiModel';

export interface PlaceSuggestion {
  placeId: string;
  description: string;
}

export interface ResolvedDestination {
  lat: number;
  lng: number;
  label: string;
  panoId?: string;
}

export interface CoverageResult {
  ok: boolean;
  lat?: number;
  lng?: number;
  panoId?: string;
  reason?: 'no-coverage' | PlaceSearchBlockReason;
}

let placesLibraryPromise: Promise<unknown> | null = null;
/* eslint-disable @typescript-eslint/no-explicit-any */
// Places API (New) via Maps JS: AutocompleteSuggestion / Place.
// Legacy AutocompleteService/PlacesService are unavailable to new projects.
type PlacesLib = any;
let sessionToken: any = null;

async function loadPlacesLibrary(): Promise<PlacesLib | null> {
  if (typeof google === 'undefined' || !google.maps?.importLibrary) return null;
  if (!placesLibraryPromise) {
    placesLibraryPromise = google.maps.importLibrary('places');
  }
  try {
    return (await placesLibraryPromise) as PlacesLib;
  } catch {
    placesLibraryPromise = null;
    return null;
  }
}

function gate(
  meter: PlaceSearchMeter,
  opts?: { skipThrottle?: boolean },
): { ok: true } | { ok: false; reason: PlaceSearchBlockReason } {
  return getPlaceSearchBudget().allow(meter, opts);
}

export async function fetchPlaceSuggestions(input: string): Promise<PlaceSuggestion[]> {
  const allowed = gate('autocomplete');
  if (!allowed.ok) return [];
  const lib = await loadPlacesLibrary();
  if (!lib?.AutocompleteSuggestion) return [];
  try {
    sessionToken = sessionToken ?? new lib.AutocompleteSessionToken();
    const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
      sessionToken,
    });
    getPlaceSearchBudget().recordSuccess('autocomplete');
    return (suggestions ?? [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .slice(0, 8)
      .map((p: any) => ({ placeId: p.placeId, description: p.text?.toString?.() ?? String(p.text ?? '') }));
  } catch (err) {
    console.warn('[places] AutocompleteSuggestion failed (enable Places API (New) on the key)', err);
    getPlaceSearchBudget().recordError('autocomplete');
    return [];
  }
}

export async function resolvePlaceId(placeId: string): Promise<ResolvedDestination | null> {
  const allowed = gate('placeDetails');
  if (!allowed.ok) return null;
  const lib = await loadPlacesLibrary();
  if (!lib?.Place) return null;
  try {
    const place = new lib.Place({ id: placeId });
    await place.fetchFields({ fields: ['location', 'displayName', 'formattedAddress'] });
    sessionToken = null; // session ends on details fetch
    if (!place.location) throw new Error('no location');
    getPlaceSearchBudget().recordSuccess('placeDetails');
    return {
      lat: place.location.lat(),
      lng: place.location.lng(),
      label: place.displayName || place.formattedAddress || 'Place',
    };
  } catch {
    getPlaceSearchBudget().recordError('placeDetails');
    return null;
  }
}

/** Text search via Places API (New); used as a fallback when Geocoding is denied. */
export async function searchPlaceByText(query: string): Promise<ResolvedDestination | null> {
  const lib = await loadPlacesLibrary();
  if (!lib?.Place?.searchByText) return null;
  try {
    const { places } = await lib.Place.searchByText({
      textQuery: query,
      fields: ['location', 'displayName', 'formattedAddress'],
      maxResultCount: 1,
    });
    const p = places?.[0];
    if (!p?.location) return null;
    return { lat: p.location.lat(), lng: p.location.lng(), label: p.displayName || p.formattedAddress || query };
  } catch (err) {
    console.warn('[places] Place.searchByText failed', err);
    return null;
  }
}

export async function geocodeTextQuery(query: string): Promise<ResolvedDestination | null> {
  const allowed = gate('geocode');
  if (!allowed.ok) return null;
  // Geocoding denied (API not enabled / key restricted): fall back to Places text search.
  if (isGeocodeDenied()) return searchPlaceByText(query);
  if (typeof google === 'undefined' || !google.maps?.Geocoder) return searchPlaceByText(query);
  const geocoder = new google.maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ address: query }, (results, status) => {
      const statusText = String(status);
      noteGeocodeStatus(statusText);
      if (statusText === 'OK' && results?.[0]?.geometry?.location) {
        getPlaceSearchBudget().recordSuccess('geocode');
        const loc = results[0].geometry.location;
        resolve({
          lat: loc.lat(),
          lng: loc.lng(),
          label: results[0].formatted_address || query,
        });
      } else if (statusText === 'ZERO_RESULTS') {
        getPlaceSearchBudget().recordSuccess('geocode');
        resolve(null);
      } else {
        getPlaceSearchBudget().recordError('geocode');
        if (statusText === 'REQUEST_DENIED') {
          console.warn('[geocode] REQUEST_DENIED — falling back to Place.searchByText');
          resolve(searchPlaceByText(query));
        } else {
          resolve(null);
        }
      }
    });
  });
}

export function lookupStreetViewCoverage(lat: number, lng: number, panoId?: string): Promise<CoverageResult> {
  const allowed = gate('streetViewLookup');
  if (!allowed.ok) return Promise.resolve({ ok: false, reason: allowed.reason });
  if (typeof google === 'undefined' || !google.maps?.StreetViewService) {
    return Promise.resolve({ ok: false, reason: 'no-coverage' });
  }
  const sv = new google.maps.StreetViewService();
  const request: google.maps.StreetViewLocationRequest | google.maps.StreetViewPanoRequest = panoId
    ? { pano: panoId }
    : { location: { lat, lng }, radius: 80, source: google.maps.StreetViewSource.OUTDOOR };

  return new Promise((resolve) => {
    sv.getPanorama(request, (data, status) => {
      if (status === google.maps.StreetViewStatus.OK && data?.location?.latLng) {
        getPlaceSearchBudget().recordSuccess('streetViewLookup');
        resolve({
          ok: true,
          lat: data.location.latLng.lat(),
          lng: data.location.latLng.lng(),
          panoId: data.location.pano,
        });
      } else if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
        getPlaceSearchBudget().recordSuccess('streetViewLookup');
        resolve({ ok: false, reason: 'no-coverage' });
      } else {
        getPlaceSearchBudget().recordError('streetViewLookup');
        resolve({ ok: false, reason: 'no-coverage' });
      }
    });
  });
}

export async function fetchNearbyPois(
  lat: number,
  lng: number,
  categories: NearbyPoiCategory[],
): Promise<NearbyPoi[]> {
  const lib = await loadPlacesLibrary();
  if (!lib?.Place?.searchNearby || categories.length === 0) return [];
  const results: NearbyPoi[] = [];
  const seen = new Set<string>();
  let firstNearby = true;
  for (const category of categories) {
    const allowed = gate('nearby', firstNearby ? undefined : { skipThrottle: true });
    firstNearby = false;
    if (!allowed.ok) break;
    if (results.length >= PLACE_SEARCH_DEFAULTS.maxNearbyMarkers) break;
    let batch: NearbyPoi[] = [];
    try {
      const { places } = await lib.Place.searchNearby({
        fields: ['id', 'location', 'displayName'],
        locationRestriction: { center: { lat, lng }, radius: PLACE_SEARCH_DEFAULTS.nearbyRadiusM },
        includedPrimaryTypes: [NEARBY_CATEGORY_PLACE_TYPES[category]],
        maxResultCount: 20,
      });
      getPlaceSearchBudget().recordSuccess('nearby');
      batch = (places ?? [])
        .filter((p: any) => p.location && p.id)
        .map((p: any) => ({
          id: p.id, lat: p.location.lat(), lng: p.location.lng(), label: p.displayName || 'Place', category,
        }));
    } catch {
      getPlaceSearchBudget().recordError('nearby');
    }
    for (const poi of batch) {
      if (seen.has(poi.id)) continue;
      seen.add(poi.id);
      results.push(poi);
      if (results.length >= PLACE_SEARCH_DEFAULTS.maxNearbyMarkers) break;
    }
  }
  return results.slice(0, PLACE_SEARCH_DEFAULTS.maxNearbyMarkers);
}

export function buildBudgetedStaticPreviewUrl(
  lat: number,
  lng: number,
  mapsApiKey: string,
): string | undefined {
  if (!mapsApiKey) return undefined;
  const allowed = gate('staticPreview');
  if (!allowed.ok) return undefined;
  getPlaceSearchBudget().recordSuccess('staticPreview');
  return `https://maps.googleapis.com/maps/api/streetview?size=300x200&location=${lat},${lng}&key=${encodeURIComponent(mapsApiKey)}`;
}
