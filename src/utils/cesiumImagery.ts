/**
 * Cesium globe imagery helpers.
 *
 * Cesium ≥1.107 Viewer ignores the removed `imageryProvider` constructor option;
 * use `baseLayer: ImageryLayer` instead. OSM Foundation tiles
 * (`tile.openstreetmap.org`) block app User-Agents — prefer Ion (when a token
 * is baked) or CartoCDN Voyager as a free fallback.
 */

import type { CesiumImageryLayer, CesiumNamespace, CesiumTerrainProvider } from '../types/cesium';

/** CartoCDN Voyager — OSM-derived, allowed for app use (unlike tile.openstreetmap.org). */
export const CARTO_VOYAGER_URL =
  'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

export const CARTO_CREDIT = '© OpenStreetMap contributors, © CARTO';

export type GlobeImagerySource = 'ion' | 'carto';

/** Baked into the JS bundle by deploy.py the same way MAPS_KEY_DEPLOY_SENTINEL works. */
export const CESIUM_ION_TOKEN_DEPLOY_SENTINEL = '__RUNTIME_CESIUM_ION_TOKEN_SENTINEL__';

const PLACEHOLDER_ION_TOKEN_PATTERNS: RegExp[] = [
  /^your[_-]?cesium[_-]?ion[_-]?token[_-]?(here)?$/i,
  /^__RUNTIME_CESIUM_ION_TOKEN_SENTINEL__$/,
  /^placeholder/i,
  /^<.*>$/,
];

function normalizeIonToken(value: string | undefined): string {
  const trimmed = value?.trim() || '';
  return PLACEHOLDER_ION_TOKEN_PATTERNS.some((re) => re.test(trimmed)) ? '' : trimmed;
}

/** Build-time env → deploy-time baked sentinel → runtime `window.CESIUM_ION_TOKEN` (config.js). */
export function getConfiguredCesiumIonTokenFromEnv(
  reactAppToken: string | undefined,
  deploySentinel: string,
  runtimeToken: string | undefined,
): string {
  return (
    normalizeIonToken(reactAppToken) ||
    normalizeIonToken(deploySentinel) ||
    normalizeIonToken(runtimeToken)
  );
}

export function getConfiguredCesiumIonToken(): string {
  return getConfiguredCesiumIonTokenFromEnv(
    process.env.REACT_APP_CESIUM_ION_TOKEN,
    CESIUM_ION_TOKEN_DEPLOY_SENTINEL,
    typeof window !== 'undefined' ? window.CESIUM_ION_TOKEN : undefined,
  );
}

export function getCesiumIonToken(
  envToken: string | undefined = getConfiguredCesiumIonToken(),
): string {
  return (envToken ?? '').trim();
}

export function resolveGlobeImagerySource(token: string): GlobeImagerySource {
  return token.length > 0 ? 'ion' : 'carto';
}

/** Sets Ion.defaultAccessToken when a non-empty token is provided. Returns the applied token. */
export function applyCesiumIonToken(Cesium: CesiumNamespace, token: string = getCesiumIonToken()): string {
  if (token) {
    Cesium.Ion.defaultAccessToken = token;
  }
  return token;
}

export function createCartoBaseLayer(Cesium: CesiumNamespace): CesiumImageryLayer {
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: CARTO_VOYAGER_URL,
      credit: CARTO_CREDIT,
      maximumLevel: 18,
    }),
  );
}

export function createIonWorldBaseLayer(Cesium: CesiumNamespace): CesiumImageryLayer {
  return Cesium.ImageryLayer.fromWorldImagery();
}

export interface CesiumViewerLayerOptions {
  terrainProvider: CesiumTerrainProvider;
  baseLayer: CesiumImageryLayer | false;
  imagerySource: GlobeImagerySource;
}

export async function resolveMiniMapLayerOptions(Cesium: CesiumNamespace): Promise<CesiumViewerLayerOptions> {
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
        '[cesiumImagery] Ion terrain/imagery failed, using Carto ellipsoid:',
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
