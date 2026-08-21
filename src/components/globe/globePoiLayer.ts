import type { CesiumEntity, CesiumViewer } from '../../types/cesium';
import { makeBeaconCanvas, makeBookmarkCanvas, makePoiCanvas, MAX_VISIBLE_BOOKMARKS, MAX_VISIBLE_POIS, type GlobeBookmark, type GlobePOI } from './globeTypes';

export function syncGlobePoiEntities(
  viewer: CesiumViewer,
  pois: GlobePOI[],
  existing: CesiumEntity[],
): CesiumEntity[] {
  existing.forEach((e) => {
    try { viewer.entities.remove(e); } catch { /* noop */ }
  });

  if (pois.length === 0) return [];

  const poiImage = makePoiCanvas();
  return pois.slice(0, MAX_VISIBLE_POIS).map((poi) =>
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, 60),
      billboard: {
        image: poiImage,
        scale: 0.85,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: poi.label,
        font: '12px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#FFB400'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -42),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.65)'),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }),
  );
}

export function syncGlobeBookmarkEntities(
  viewer: CesiumViewer,
  bookmarks: GlobeBookmark[],
  existing: CesiumEntity[],
): CesiumEntity[] {
  existing.forEach((e) => {
    try { viewer.entities.remove(e); } catch { /* noop */ }
  });

  if (bookmarks.length === 0) return [];

  const bookmarkImage = makeBookmarkCanvas();
  return bookmarks.slice(0, MAX_VISIBLE_BOOKMARKS).map((bm) =>
    viewer.entities.add({
      name: bm.name,
      position: Cesium.Cartesian3.fromDegrees(bm.lng, bm.lat, 70),
      billboard: {
        image: bookmarkImage,
        scale: 0.95,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `📌 ${bm.name}`,
        font: 'bold 12px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#00FF80'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -40),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: {
        bookmarkId: bm.id,
        bookmarkLat: bm.lat,
        bookmarkLng: bm.lng,
        bookmarkName: bm.name,
      },
    }),
  );
}

export function addLocationBeacon(
  viewer: CesiumViewer,
  lat: number,
  lng: number,
): CesiumEntity {
  const beaconImage = makeBeaconCanvas();
  return viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat, 80),
    billboard: {
      image: beaconImage,
      scale: 1.0,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
    },
    label: {
      text: '📍 You are here',
      font: 'bold 13px sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#00CCFF'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -55),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.75)'),
      backgroundPadding: new Cesium.Cartesian2(8, 4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}
