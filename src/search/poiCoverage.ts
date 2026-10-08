/**
 * Nearby-POI Street View coverage: is there a panorama within ~50 m of a pin?
 *
 * Opt-in from the coverage map ("Check POI coverage"). A POI within the radius
 * of an already-walked coverage-graph node is answered for free; otherwise one
 * metered `getPanorama({ location, radius })` (`panorama` / `coverage-poi`).
 * Answers are cached per POI id for the session; at most
 * `maxNearbyMarkers` POIs are checked per batch.
 */

import { getMapsCallBudget } from '../services/maps/callBudget';
import { nearestGraphNode, type PanoGraphNode } from '../services/maps/panoCoverageGraph';
import { PLACE_SEARCH_DEFAULTS } from './placeSearchBudget';
import type { NearbyPoi } from './poiModel';

export const POI_COVERAGE_RADIUS_M = 50;

export type PoiCoverageStatus = 'covered' | 'none' | 'unknown';

export interface PoiCoverage {
  status: PoiCoverageStatus;
  /** Nearest pano when covered. */
  panoId?: string;
  lat?: number;
  lng?: number;
}

/** One coverage lookup; null = the lookup could not be made (budget, no SDK, error). */
export type PoiCoverageLookup = (lat: number, lng: number, radiusM: number) => Promise<PoiCoverage | null>;

const coverageCache = new Map<string, PoiCoverage>();

/** Test-only. */
export function resetPoiCoverageCacheForTests(): void {
  coverageCache.clear();
}

export async function classifyPoiCoverage(
  pois: readonly NearbyPoi[],
  lookup: PoiCoverageLookup,
  graphNodes: readonly PanoGraphNode[] = [],
  maxLookups: number = PLACE_SEARCH_DEFAULTS.maxNearbyMarkers,
): Promise<Map<string, PoiCoverage>> {
  const out = new Map<string, PoiCoverage>();
  let lookups = 0;
  for (const poi of pois) {
    const cached = coverageCache.get(poi.id);
    if (cached) {
      out.set(poi.id, cached);
      continue;
    }
    const near = nearestGraphNode(graphNodes, poi.lat, poi.lng, POI_COVERAGE_RADIUS_M);
    if (near) {
      const hit: PoiCoverage = { status: 'covered', panoId: near.panoId, lat: near.lat, lng: near.lng };
      coverageCache.set(poi.id, hit);
      out.set(poi.id, hit);
      continue;
    }
    if (lookups >= maxLookups) {
      out.set(poi.id, { status: 'unknown' });
      continue;
    }
    lookups += 1;
    const result = await lookup(poi.lat, poi.lng, POI_COVERAGE_RADIUS_M);
    if (result && result.status !== 'unknown') coverageCache.set(poi.id, result);
    out.set(poi.id, result ?? { status: 'unknown' });
  }
  return out;
}

/** Production lookup: one metered outdoor `getPanorama` within `radiusM`, counted under `source`. */
export function createMeteredPoiCoverageLookup(
  svc: google.maps.StreetViewService,
  source = 'coverage-poi',
): PoiCoverageLookup {
  return (lat, lng, radiusM) => {
    if (!getMapsCallBudget().tryConsume('panorama', source)) return Promise.resolve(null);
    return new Promise((resolve) => {
      svc.getPanorama(
        { location: { lat, lng }, radius: radiusM, source: google.maps.StreetViewSource.OUTDOOR },
        (data, status) => {
          const latLng = data?.location?.latLng;
          if (status === google.maps.StreetViewStatus.OK && latLng) {
            resolve({ status: 'covered', panoId: data?.location?.pano, lat: latLng.lat(), lng: latLng.lng() });
          } else if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
            resolve({ status: 'none' });
          } else {
            resolve(null);
          }
        },
      );
    });
  };
}

export const POI_COVERAGE_COLORS: Record<PoiCoverageStatus, string> = {
  covered: '#2ECC71',
  none: '#E74C3C',
  unknown: '#B0B0B0',
};
