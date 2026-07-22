/**
 * Cesium globe imagery helpers.
 *
 * Cesium ≥1.107 Viewer ignores the removed `imageryProvider` constructor option;
 * use `baseLayer: ImageryLayer` instead. OSM Foundation tiles
 * (`tile.openstreetmap.org`) block app User-Agents — prefer Ion (when a token
 * is baked) or CartoCDN Voyager as a free fallback.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** CartoCDN Voyager — OSM-derived, allowed for app use (unlike tile.openstreetmap.org). */
export const CARTO_VOYAGER_URL =
  'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

export const CARTO_CREDIT = '© OpenStreetMap contributors, © CARTO';

export type GlobeImagerySource = 'ion' | 'carto';

export function getCesiumIonToken(
  envToken: string | undefined = process.env.REACT_APP_CESIUM_ION_TOKEN,
): string {
  return (envToken ?? '').trim();
}

export function resolveGlobeImagerySource(token: string): GlobeImagerySource {
  return token.length > 0 ? 'ion' : 'carto';
}

/** Sets Ion.defaultAccessToken when a non-empty token is provided. Returns the applied token. */
export function applyCesiumIonToken(Cesium: any, token: string = getCesiumIonToken()): string {
  if (token) {
    Cesium.Ion.defaultAccessToken = token;
  }
  return token;
}

export function createCartoBaseLayer(Cesium: any): any {
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: CARTO_VOYAGER_URL,
      credit: CARTO_CREDIT,
      maximumLevel: 18,
    }),
  );
}

export function createIonWorldBaseLayer(Cesium: any): any {
  return Cesium.ImageryLayer.fromWorldImagery();
}

/**
 * Resolve the Viewer `baseLayer` for full-screen GlobeView.
 * Prefers Ion world imagery when `REACT_APP_CESIUM_ION_TOKEN` is set; otherwise CartoCDN.
 * On Ion construction failure, falls back to Carto so Orbital Drop still works on a mapped globe.
 */
export function resolveGlobeBaseLayer(Cesium: any): any {
  const token = applyCesiumIonToken(Cesium);
  if (resolveGlobeImagerySource(token) === 'ion') {
    try {
      return createIonWorldBaseLayer(Cesium);
    } catch (err) {
      console.warn('[cesiumImagery] Ion world imagery failed, falling back to CartoCDN:', err);
    }
  }
  return createCartoBaseLayer(Cesium);
}

export interface CesiumViewerLayerOptions {
  terrainProvider: any;
  baseLayer: any;
  imagerySource: GlobeImagerySource;
}

/**
 * MiniMap globe options: Ion terrain + world imagery when token works;
 * otherwise ellipsoid + CartoCDN so the mini globe is never blank.
 */
export async function resolveMiniMapLayerOptions(Cesium: any): Promise<CesiumViewerLayerOptions> {
  const token = applyCesiumIonToken(Cesium);
  if (resolveGlobeImagerySource(token) === 'ion') {
    try {
      const terrainProvider = await Cesium.createWorldTerrainAsync();
      return {
        terrainProvider,
        baseLayer: createIonWorldBaseLayer(Cesium),
        imagerySource: 'ion',
      };
    } catch (err) {
      console.warn(
        '[cesiumImagery] Ion terrain/imagery failed for MiniMap, using Carto ellipsoid:',
        err,
      );
    }
  }
  return {
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    baseLayer: createCartoBaseLayer(Cesium),
    imagerySource: 'carto',
  };
}
