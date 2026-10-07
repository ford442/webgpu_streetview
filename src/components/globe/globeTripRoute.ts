import type { CesiumEntity, CesiumViewer } from '../../types/cesium';
import type { ActiveRoute } from '../../services/routing/routeGeometry';

/** Cesium does not need every OSRM vertex to draw a road at globe scale. */
const MAX_GLOBE_ROUTE_POINTS = 2000;

/**
 * Draw the planned trip on the globe: the road polyline (clamped to the
 * terrain), plus a marker per stop. Replaces whatever the previous call drew;
 * `null` clears it. No new map library — the globe already draws polylines.
 */
export function syncGlobeTripRoute(
  viewer: CesiumViewer,
  route: ActiveRoute | null,
  existing: CesiumEntity[],
): CesiumEntity[] {
  existing.forEach((e) => {
    try { viewer.entities.remove(e); } catch { /* noop */ }
  });
  if (!route || route.polyline.length < 2) return [];

  const stride = Math.max(1, Math.ceil(route.polyline.length / MAX_GLOBE_ROUTE_POINTS));
  const pts = route.polyline.filter((_, i) => i % stride === 0 || i === route.polyline.length - 1);
  const entities: CesiumEntity[] = [
    viewer.entities.add({
      polyline: {
        positions: pts.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0)),
        width: 5,
        material: Cesium.Color.fromCssColorString('rgba(0,200,255,0.9)'),
        clampToGround: true,
      },
    }),
  ];
  route.stops.forEach((stop, i) => {
    const last = i === route.stops.length - 1;
    entities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(stop.lng, stop.lat, 60),
      point: {
        pixelSize: last || i === 0 ? 12 : 9,
        color: Cesium.Color.fromCssColorString(last ? '#ffcc00' : i === 0 ? '#00c8ff' : '#ffffff'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
  });
  return entities;
}
