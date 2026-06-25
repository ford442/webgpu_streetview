/** Normalized panorama pan coords (matches streetview.wgsl PanoramaUniforms panX/panY). */
export function headingPitchToPan(heading: number, pitch: number): { panX: number; panY: number } {
  const panX = ((heading % 360) + 360) % 360 / 360;
  const panY = (pitch + 90) / 180;
  return { panX, panY };
}

/** Wrap heading delta across the 0/1 seam (WGSL wrapDelta). */
export function wrapPanDelta(currentPanX: number, capturePanX: number): number {
  let d = currentPanX - capturePanX;
  if (d > 0.5) d -= 1.0;
  if (d < -0.5) d += 1.0;
  return d;
}

/** UV shift applied to the frozen snapshot while holdActive (lookScale matches shader). */
export function heldLookAroundUvDelta(
  heading: number,
  pitch: number,
  captureHeading: number,
  capturePitch: number,
  zoom: number
): { deltaX: number; deltaY: number } {
  const current = headingPitchToPan(heading, pitch);
  const capture = headingPitchToPan(captureHeading, capturePitch);
  const lookScaleH = 4.0 / Math.max(zoom, 0.001);
  const lookScaleV = 2.8 / Math.max(zoom, 0.001);
  return {
    deltaX: wrapPanDelta(current.panX, capture.panX) * lookScaleH,
    deltaY: (current.panY - capture.panY) * lookScaleV,
  };
}
