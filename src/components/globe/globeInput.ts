import type {
  CesiumCartesian2,
  CesiumPropertyBag,
  CesiumScreenSpaceEventHandler,
  CesiumViewer,
} from '../../types/cesium';
import type { GlobeWaypoint } from './globeTypes';

const INPUT_GUARD_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'wheel'] as const;

/** Stop globe canvas events from reaching window-level Street View handlers. */
export function bindGlobeCanvasInputGuard(canvas: HTMLCanvasElement): () => void {
  const stop = (e: Event) => e.stopPropagation();
  for (const type of INPUT_GUARD_EVENTS) {
    canvas.addEventListener(type, stop);
  }
  return () => {
    for (const type of INPUT_GUARD_EVENTS) {
      canvas.removeEventListener(type, stop);
    }
  };
}

export function pickGlobeLatLng(
  viewer: CesiumViewer,
  windowPosition: CesiumCartesian2,
): GlobeWaypoint | null {
  const cartesian = viewer.camera.pickEllipsoid(
    windowPosition,
    viewer.scene.globe.ellipsoid,
  );
  if (!cartesian) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lng: Cesium.Math.toDegrees(carto.longitude),
  };
}

export function bookmarkLatLngFromPicked(
  picked: { id?: { properties?: CesiumPropertyBag } } | undefined,
): GlobeWaypoint | null {
  const props = picked?.id?.properties;
  if (!props) return null;
  try {
    const lat = props.bookmarkLat?.getValue();
    const lng = props.bookmarkLng?.getValue();
    if (lat === undefined || lng === undefined) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export interface GlobeInputCallbacks {
  onScoutPreview: (wp: GlobeWaypoint) => void;
  onOrbitalDrop: (wp: GlobeWaypoint) => void;
  onAddWaypoint: (wp: GlobeWaypoint) => void;
  onBookmarkDrop: (wp: GlobeWaypoint) => void;
}

export function attachGlobeInput(
  viewer: CesiumViewer,
  callbacks: GlobeInputCallbacks,
): { handler: CesiumScreenSpaceEventHandler; detach: () => void } {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  const unbindGuard = bindGlobeCanvasInputGuard(viewer.scene.canvas);

  handler.setInputAction((event: { position: CesiumCartesian2 }) => {
    const wp = pickGlobeLatLng(viewer, event.position);
    if (wp) callbacks.onOrbitalDrop(wp);
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  handler.setInputAction((event: { position: CesiumCartesian2 }) => {
    const bookmark = bookmarkLatLngFromPicked(viewer.scene.pick(event.position));
    if (bookmark) {
      callbacks.onBookmarkDrop(bookmark);
      return;
    }
    const wp = pickGlobeLatLng(viewer, event.position);
    if (wp) callbacks.onScoutPreview(wp);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((event: { position: CesiumCartesian2 }) => {
    const wp = pickGlobeLatLng(viewer, event.position);
    if (wp) callbacks.onAddWaypoint(wp);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK, Cesium.KeyboardEventModifier.SHIFT);

  return {
    handler,
    detach: () => {
      unbindGuard();
      handler.destroy();
    },
  };
}
