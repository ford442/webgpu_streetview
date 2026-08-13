/** Shared nearby-POI model for Globe + MiniMap. */

export const NEARBY_POI_CATEGORIES = ['fuel', 'food', 'viewpoint', 'lodging'] as const;
export type NearbyPoiCategory = (typeof NEARBY_POI_CATEGORIES)[number];

export interface NearbyPoi {
  id: string;
  lat: number;
  lng: number;
  label: string;
  category: NearbyPoiCategory;
}

export const NEARBY_CATEGORY_PLACE_TYPES: Record<NearbyPoiCategory, string> = {
  fuel: 'gas_station',
  food: 'restaurant',
  viewpoint: 'tourist_attraction',
  lodging: 'lodging',
};

export const NEARBY_CATEGORY_LABELS: Record<NearbyPoiCategory, string> = {
  fuel: 'Fuel',
  food: 'Food',
  viewpoint: 'Viewpoint',
  lodging: 'Lodging',
};

export function nearbyPoisToGlobe(pois: NearbyPoi[]): Array<{ lat: number; lng: number; label: string }> {
  return pois.map((poi) => ({
    lat: poi.lat,
    lng: poi.lng,
    label: `${NEARBY_CATEGORY_LABELS[poi.category]} · ${poi.label}`,
  }));
}
