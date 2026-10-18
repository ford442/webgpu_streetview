/** Object3D-like head pivot used while the Three.js graph is still booting. */
export interface SeatGroupLike {
    position?: { set: (x: number, y: number, z: number) => unknown };
}

export interface SeatCameraPosition {
    x: number;
    y: number;
    z: number;
}

/**
 * Place the head pivot (driver's eye point) at the vehicle camera anchor plus
 * the seat slider.
 * Returns false when the graph is not ready (bootstrap / missing config) so
 * callers never read `.position` on undefined.
 */
export function applyDriverSeatOffset(
    headPivot: SeatGroupLike | null | undefined,
    cameraPosition: SeatCameraPosition | null | undefined,
    seatOffset: number,
): boolean {
    const position = headPivot?.position;
    if (!position || !cameraPosition) {
        return false;
    }
    position.set(
        cameraPosition.x,
        cameraPosition.y,
        cameraPosition.z + seatOffset,
    );
    return true;
}
