/**
 * Street View zoom ↔ field of view.
 *
 * The cabin camera must use the panorama's own FOV or the outside slides
 * against the window frames as the head turns. Street View's zoom is a
 * horizontal FOV (≈ 180° / 2^zoom); Three.js `PerspectiveCamera.fov` is
 * vertical, so the conversion depends on the viewport aspect.
 */

const DEG = Math.PI / 180;

/** The integer zoom actually applied to the Maps panorama (`useStreetView` floors it). */
export function streetViewZoomLevel(zoom: number): number {
  return Math.floor(zoom);
}

/** Horizontal FOV (degrees) the panorama shows at a given store zoom. */
function streetViewHorizontalFov(zoom: number): number {
  return 180 / 2 ** streetViewZoomLevel(zoom);
}

/** Vertical FOV (degrees) for a horizontal FOV at `aspect` = width / height. */
function verticalFovFromHorizontal(horizontalFovDeg: number, aspect: number): number {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return (2 * Math.atan(Math.tan((horizontalFovDeg * DEG) / 2) / safeAspect)) / DEG;
}

/** `camera.fov` that matches the panorama at this zoom and viewport aspect. */
export function panoramaMatchedVerticalFov(zoom: number, aspect: number): number {
  return verticalFovFromHorizontal(streetViewHorizontalFov(zoom), aspect);
}
