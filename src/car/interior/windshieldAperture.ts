import * as THREE from 'three';

/**
 * The windshield's glass aperture as clip planes — what lets the portal show
 * road texels "through the glass only".
 *
 * The portal is a sheet of geometry cloned from the glass and nudged toward the
 * cabin; its fragments replace the road pixels behind them. Wherever that sheet
 * pokes past the frame — an authored hero mesh that runs under the A-pillar
 * trim, a rake/curve that lifts an edge — it would paint road texels onto the
 * pillar. Clipping the sheet to the glass's inner opening stops that at the
 * rasteriser: with `clip-distances` the trim happens per vertex, so unlike a
 * fragment `discard` it costs no early-Z and leaves the aperture edge
 * MSAA-clean. That is why the portal is gated on the feature instead of quietly
 * falling back to discard.
 *
 * Planes here are kept in the **parent's local space** (the frame the windshield
 * mesh's own `matrix` lives in) and are static. The world-space copy three's
 * `ClippingGroup` needs is produced per frame from the group's `matrixWorld` —
 * the cabin body rotates every frame (`CarInteriorAnimator.setCarOrientation`),
 * so a world plane cached at build time would be wrong on the second tick.
 */

/** Inset from the geometry's edge, in the mesh's local units — about a seal's width. */
export const APERTURE_INSET = 0.03;

/**
 * Indices (0=x, 1=y, 2=z) of a box's two widest axes, widest first — the glass
 * sheet's width and height axes, whichever way the asset was authored. The
 * narrowest axis is the sheet's thickness / curve depth. Ties break by axis order.
 */
function sheetAxes(size: THREE.Vector3): [number, number] {
    const order = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a) || a - b);
    return [order[0]!, order[1]!];
}

/**
 * Four inward-facing planes (two per sheet axis) for a glass mesh, in the space
 * `meshMatrix` maps into. Follows three's clipping convention: a point is kept
 * where `plane.distanceToPoint(p) >= 0`.
 *
 * Bounds come from the geometry's own bounding box in mesh space, so the planes
 * follow the glass under any transform, and the sheet may be authored in any of
 * the box's axes (the procedural and hero windshields are XY planes; an XZ sheet
 * works too). A sheet rotated *within* its geometry so it is not axis-aligned is
 * not handled — bake the rotation into the node transform instead.
 */
export function computeApertureLocalPlanes(
    geometry: THREE.BufferGeometry,
    meshMatrix: THREE.Matrix4,
    inset: number = APERTURE_INSET,
): THREE.Plane[] {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return [];

    const size = box.getSize(new THREE.Vector3());
    const planes: THREE.Plane[] = [];
    for (const axis of sheetAxes(size)) {
        // Never invert a sliver: a degenerate glass keeps its full extent.
        const lo = box.min.getComponent(axis);
        const hi = box.max.getComponent(axis);
        const cut = Math.min(inset, (hi - lo) * 0.25);
        const normal = new THREE.Vector3().setComponent(axis, 1);
        planes.push(new THREE.Plane(normal.clone(), -(lo + cut))); //          keep >= min
        planes.push(new THREE.Plane(normal.clone().negate(), hi - cut)); //    keep <= max
    }
    return planes.map((plane) => plane.applyMatrix4(meshMatrix));
}

/**
 * Glass width ÷ height in world units, for round droplets. Width is the widest
 * axis; height folds the other two together (`hypot`) so a raked, curved screen
 * isn't read as shorter than it is. Mesh scale is applied per axis so a resized
 * glass keeps its proportions. Falls back to the procedural windshield's
 * proportions on a degenerate mesh.
 */
export function computeGlassAspect(
    geometry: THREE.BufferGeometry,
    scale: THREE.Vector3,
): number {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return DEFAULT_GLASS_ASPECT;
    const extents = [
        (box.max.x - box.min.x) * Math.abs(scale.x),
        (box.max.y - box.min.y) * Math.abs(scale.y),
        (box.max.z - box.min.z) * Math.abs(scale.z),
    ].sort((a, b) => b - a);
    const aspect = extents[0]! / Math.hypot(extents[1]!, extents[2]!);
    return Number.isFinite(aspect) && aspect > 0.1 && aspect < 20 ? aspect : DEFAULT_GLASS_ASPECT;
}

/** 1.9 × 0.75 procedural glass. */
export const DEFAULT_GLASS_ASPECT = 1.9 / 0.75;
