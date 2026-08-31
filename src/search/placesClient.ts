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
let placesService: google.maps.places.PlacesService | null = null;
let autocompleteService: google.maps.places.AutocompleteService | null = null;
let dummyPlacesDiv: HTMLDivElement | null = null;

async function loadPlacesLibrary(): Promise<unknown | null> {
  if (typeof google === 'undefined' || !google.maps?.importLibrary) return null;
  if (!placesLibraryPromise) {
    placesLibraryPromise = google.maps.importLibrary('places');
  }
  try {
    return await placesLibraryPromise;
  } catch {
    placesLibraryPromise = null;
    return null;
  }
}

function getPlacesService(): google.maps.places.PlacesService | null {
  if (placesService) return placesService;
  if (typeof google === 'undefined' || !google.maps?.places?.PlacesService) return null;
  dummyPlacesDiv = dummyPlacesDiv ?? document.createElement('div');
  placesService = new google.maps.places.PlacesService(dummyPlacesDiv);
  return placesService;
}

function getAutocompleteService(): google.maps.places.AutocompleteService | null {
  if (autocompleteService) return autocompleteService;
  if (typeof google === 'undefined' || !google.maps?.places?.AutocompleteService) return null;
  autocompleteService = new google.maps.places.AutocompleteService();
  return autocompleteService;
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
  if (!lib) return [];
  const svc = getAutocompleteService();
  if (!svc) return [];

  return new Promise((resolve) => {
    svc.getPlacePredictions({ input }, (predictions, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
        getPlaceSearchBudget().recordSuccess('autocomplete');
        resolve(
          predictions.slice(0, 8).map((p) => ({
            placeId: p.place_id,
            description: p.description,
          })),
        );
      } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        getPlaceSearchBudget().recordSuccess('autocomplete');
        resolve([]);
      } else {
        getPlaceSearchBudget().recordError('autocomplete');
        resolve([]);
      }
    });
  });
}

export async function resolvePlaceId(placeId: string): Promise<ResolvedDestination | null> {
  const allowed = gate('placeDetails');
  if (!allowed.ok) return null;
  await loadPlacesLibrary();
  const svc = getPlacesService();
  if (!svc) return null;

  return new Promise((resolve) => {
    svc.getDetails(
      { placeId, fields: ['geometry', 'name', 'formatted_address'] },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
          getPlaceSearchBudget().recordSuccess('placeDetails');
          resolve({
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            label: place.name || place.formatted_address || 'Place',
          });
        } else {
          getPlaceSearchBudget().recordError('placeDetails');
          resolve(null);
        }
      },
    );
  });
}

export async function geocodeTextQuery(query: string): Promise<ResolvedDestination | null> {
  const allowed = gate('geocode');
  if (!allowed.ok) return null;
  if (isGeocodeDenied()) return null;
  if (typeof google === 'undefined' || !google.maps?.Geocoder) return null;
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
        resolve(null);
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
  await loadPlacesLibrary();
  const svc = getPlacesService();
  if (!svc || categories.length === 0) return [];

  const results: NearbyPoi[] = [];
  const seen = new Set<string>();

  let firstNearby = true;
  for (const category of categories) {
    const allowed = gate('nearby', firstNearby ? undefined : { skipThrottle: true });
    firstNearby = false;
    if (!allowed.ok) break;
    if (results.length >= PLACE_SEARCH_DEFAULTS.maxNearbyMarkers) break;
    const type = NEARBY_CATEGORY_PLACE_TYPES[category];
    const batch = await new Promise<NearbyPoi[]>((resolve) => {
      svc.nearbySearch(
        {
          location: { lat, lng },
          radius: PLACE_SEARCH_DEFAULTS.nearbyRadiusM,
          type,
        },
        (places, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && places) {
            getPlaceSearchBudget().recordSuccess('nearby');
            resolve(
              places
                .filter((p) => p.geometry?.location && p.place_id)
                .map((p) => ({
                  id: p.place_id!,
                  lat: p.geometry!.location!.lat(),
                  lng: p.geometry!.location!.lng(),
                  label: p.name || 'Place',
                  category,
                })),
            );
          } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            getPlaceSearchBudget().recordSuccess('nearby');
            resolve([]);
          } else {
            getPlaceSearchBudget().recordError('nearby');
            resolve([]);
          }
        },
      );
    });
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
