import type { CesiumEntity, CesiumViewer } from '../../types/cesium';
import { makeWaypointCanvas, type GlobeWaypoint } from './globeTypes';

export interface GlobeAutopilotVisuals {
  waypointEntities: CesiumEntity[];
  polylineEntity: CesiumEntity | null;
}

export function syncGlobeAutopilotVisuals(
  viewer: CesiumViewer,
  waypoints: GlobeWaypoint[],
  existing: GlobeAutopilotVisuals,
): GlobeAutopilotVisuals {
  existing.waypointEntities.forEach((e) => {
    try { viewer.entities.remove(e); } catch { /* noop */ }
  });
  if (existing.polylineEntity) {
    try { viewer.entities.remove(existing.polylineEntity); } catch { /* noop */ }
  }

  if (waypoints.length === 0) {
    return { waypointEntities: [], polylineEntity: null };
  }

  const wpImage = makeWaypointCanvas();
  const waypointEntities = waypoints.map((wp, i) =>
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, 50),
      billboard: {
        image: wpImage,
        scale: 1.0,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `WP ${i + 1}`,
        font: 'bold 11px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#FF3232'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }),
  );

  let polylineEntity: CesiumEntity | null = null;
  if (waypoints.length >= 2) {
    const positions = waypoints.map((wp) =>
      Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, 50),
    );
    polylineEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 3,
        material: Cesium.Color.fromCssColorString('rgba(255,50,50,0.8)'),
        clampToGround: false,
      },
    });
  }

  return { waypointEntities, polylineEntity };
}
