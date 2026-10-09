/**
 * Cesium mode of the coverage map: a top-down viewer showing the linked-pano
 * graph (polylines + points) and nearby-POI pins coloured by coverage.
 *
 * Coverage comes from the pano graph, not from Google coverage tiles: pulling
 * Google's Street View coverage tiles straight into `UrlTemplateImageryProvider`
 * means hitting Maps tile endpoints outside a Maps SDK, which the Google Maps
 * Platform terms don't allow. The sanctioned route is the Map Tiles API
 * (2D tiles with the `layerStreetview` overlay: session token, separate SKU,
 * Google attribution), a separate billing decision that needs a
 * BILLING_SAFETY_CHECKLIST.md row first.
 */

import type { CesiumEntity, CesiumViewer } from '../../types/cesium';
import { resolveMiniMapLayerOptions } from '../../utils/cesiumImagery';
import { bindGlobeCanvasInputGuard, pickGlobeLatLng } from '../globe/globeInput';
import type { PanoGraph } from '../../services/maps/panoCoverageGraph';
import { POI_COVERAGE_COLORS, type PoiCoverage } from '../../search/poiCoverage';
import type { NearbyPoi } from '../../search/poiModel';

/** Eye height for the top-down view (~a few city blocks across). */
export const COVERAGE_MAP_CESIUM_ALTITUDE_M = 900;

const GRAPH_LINE_COLOR = '#1E90FF';
const GRAPH_NODE_COLOR = '#4FC3F7';
const CURRENT_COLOR = '#00CCFF';

export interface CesiumCoverageHandlers {
  onPickPano: (panoId: string) => void;
  onPickLatLng: (lat: number, lng: number) => void;
}

export interface CesiumCoverageScene {
  viewer: CesiumViewer;
  centerOn(lat: number, lng: number): void;
  setCurrent(lat: number, lng: number): void;
  setGraph(graph: PanoGraph | null, currentPanoId: string | null): void;
  setPois(pois: readonly NearbyPoi[], coverage: ReadonlyMap<string, PoiCoverage>): void;
  destroy(): void;
}

export async function createCesiumCoverageScene(
  container: HTMLElement,
  lat: number,
  lng: number,
  handlers: CesiumCoverageHandlers,
): Promise<CesiumCoverageScene> {
  const { terrainProvider, baseLayer } = await resolveMiniMapLayerOptions(Cesium);
  const viewer = new Cesium.Viewer(container, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    terrainProvider,
    baseLayer,
  });

  const unguard = bindGlobeCanvasInputGuard(viewer.scene.canvas);
  const input = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  input.setInputAction((event) => {
    const panoId = viewer.scene.pick(event.position)?.id?.properties?.panoId?.getValue();
    if (panoId) {
      handlers.onPickPano(panoId);
      return;
    }
    const wp = pickGlobeLatLng(viewer, event.position);
    if (wp) handlers.onPickLatLng(wp.lat, wp.lng);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  let current: CesiumEntity | null = null;
  let graphEntities: CesiumEntity[] = [];
  let poiEntities: CesiumEntity[] = [];

  const removeAll = (list: CesiumEntity[]) => {
    for (const e of list) {
      try { viewer.entities.remove(e); } catch { /* noop */ }
    }
  };

  const scene: CesiumCoverageScene = {
    viewer,
    centerOn(cLat, cLng) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(cLng, cLat, COVERAGE_MAP_CESIUM_ALTITUDE_M),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      });
    },
    setCurrent(cLat, cLng) {
      if (current) removeAll([current]);
      current = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cLng, cLat),
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString(CURRENT_COLOR),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    },
    setGraph(graph, currentPanoId) {
      removeAll(graphEntities);
      graphEntities = [];
      if (!graph) return;
      const byId = new Map(graph.nodes.map((n) => [n.panoId, n]));
      const lineColor = Cesium.Color.fromCssColorString(GRAPH_LINE_COLOR);
      for (const edge of graph.edges) {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) continue;
        graphEntities.push(viewer.entities.add({
          polyline: {
            positions: [Cesium.Cartesian3.fromDegrees(a.lng, a.lat), Cesium.Cartesian3.fromDegrees(b.lng, b.lat)],
            width: 4,
            material: lineColor,
            clampToGround: true,
          },
        }));
      }
      const nodeColor = Cesium.Color.fromCssColorString(GRAPH_NODE_COLOR);
      for (const node of graph.nodes) {
        if (node.panoId === currentPanoId) continue;
        graphEntities.push(viewer.entities.add({
          name: node.description || node.panoId,
          position: Cesium.Cartesian3.fromDegrees(node.lng, node.lat),
          point: {
            pixelSize: 9,
            color: nodeColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { panoId: node.panoId },
        }));
      }
    },
    setPois(pois, coverage) {
      removeAll(poiEntities);
      poiEntities = pois.map((poi) => {
        const cov = coverage.get(poi.id);
        const status = cov?.status ?? 'unknown';
        return viewer.entities.add({
          name: poi.label,
          position: Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat),
          point: {
            pixelSize: 12,
            color: Cesium.Color.fromCssColorString(POI_COVERAGE_COLORS[status]),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: poi.label,
            font: '12px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          ...(cov?.panoId ? { properties: { panoId: cov.panoId } } : {}),
        });
      });
    },
    destroy() {
      input.destroy();
      unguard();
      if (!viewer.isDestroyed()) viewer.destroy();
    },
  };

  scene.centerOn(lat, lng);
  scene.setCurrent(lat, lng);
  return scene;
}
