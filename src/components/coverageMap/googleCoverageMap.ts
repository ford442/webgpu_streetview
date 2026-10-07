/**
 * Google mode of the coverage map: a visible top-down `google.maps.Map`.
 *
 * Billing: creating the map is one Dynamic Maps load, so it is built only when
 * the user opens the coverage map in Google mode (and kept while the panel is
 * open, so flipping modes doesn't bill a second load).
 * `StreetViewCoverageLayer` streams Street View coverage tiles on every pan /
 * zoom, so it is attached only while the user's "Street View coverage" toggle
 * is on — never by default.
 */

import { POI_COVERAGE_COLORS, type PoiCoverage } from '../../search/poiCoverage';
import type { NearbyPoi } from '../../search/poiModel';

export const COVERAGE_MAP_GOOGLE_ZOOM = 17;

export interface GoogleCoverageHandlers {
  onPickLatLng: (lat: number, lng: number) => void;
  onPickPano: (panoId: string) => void;
}

export interface GoogleCoverageMap {
  map: google.maps.Map;
  centerOn(lat: number, lng: number): void;
  setCurrent(lat: number, lng: number): void;
  setCoverageLayerVisible(visible: boolean): void;
  setPois(pois: readonly NearbyPoi[], coverage: ReadonlyMap<string, PoiCoverage>): void;
  destroy(): void;
}

export function createGoogleCoverageMap(
  container: HTMLElement,
  lat: number,
  lng: number,
  handlers: GoogleCoverageHandlers,
): GoogleCoverageMap {
  const map = new google.maps.Map(container, {
    center: { lat, lng },
    zoom: COVERAGE_MAP_GOOGLE_ZOOM,
    mapTypeId: 'roadmap',
    tilt: 0,
    disableDefaultUI: true,
    zoomControl: true,
    clickableIcons: false,
    streetViewControl: false,
    keyboardShortcuts: false,
    ...(process.env.REACT_APP_GOOGLE_MAPS_MAP_ID
      ? { mapId: process.env.REACT_APP_GOOGLE_MAPS_MAP_ID }
      : {}),
  });

  const clickListener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
    if (e.latLng) handlers.onPickLatLng(e.latLng.lat(), e.latLng.lng());
  });

  const current = new google.maps.Circle({
    map,
    center: { lat, lng },
    radius: 6,
    strokeColor: '#FFFFFF',
    strokeWeight: 3,
    fillColor: '#00CCFF',
    fillOpacity: 1,
    clickable: false,
    zIndex: 10,
  });

  let coverageLayer: google.maps.StreetViewCoverageLayer | null = null;
  let poiCircles: google.maps.Circle[] = [];
  let poiListeners: google.maps.MapsEventListener[] = [];

  const clearPois = () => {
    poiListeners.forEach((l) => l.remove());
    poiCircles.forEach((c) => c.setMap(null));
    poiListeners = [];
    poiCircles = [];
  };

  return {
    map,
    centerOn(cLat, cLng) {
      map.panTo({ lat: cLat, lng: cLng });
    },
    setCurrent(cLat, cLng) {
      current.setCenter({ lat: cLat, lng: cLng });
    },
    setCoverageLayerVisible(visible) {
      if (visible) {
        coverageLayer ??= new google.maps.StreetViewCoverageLayer();
        coverageLayer.setMap(map);
      } else {
        coverageLayer?.setMap(null);
      }
    },
    setPois(pois, coverage) {
      clearPois();
      for (const poi of pois) {
        const cov = coverage.get(poi.id);
        const circle = new google.maps.Circle({
          map,
          center: { lat: poi.lat, lng: poi.lng },
          radius: 9,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
          fillColor: POI_COVERAGE_COLORS[cov?.status ?? 'unknown'],
          fillOpacity: 0.95,
          clickable: true,
          zIndex: 5,
        });
        poiListeners.push(circle.addListener('click', () => {
          if (cov?.panoId) handlers.onPickPano(cov.panoId);
          else handlers.onPickLatLng(poi.lat, poi.lng);
        }));
        poiCircles.push(circle);
      }
    },
    destroy() {
      clearPois();
      clickListener.remove();
      coverageLayer?.setMap(null);
      current.setMap(null);
    },
  };
}
