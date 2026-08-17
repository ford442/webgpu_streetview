/** Object3D-like seat group used while the Three.js graph is still booting. */
export interface SeatGroupLike {
    position?: { set: (x: number, y: number, z: number) => unknown };
}

export interface SeatCameraPosition {
    x: number;
    y: number;
    z: number;
}

/**
 * Place the driver-seat group at the vehicle camera anchor plus seat slider.
 * Returns false when the graph is not ready (bootstrap / missing config) so
 * callers never read `.position` on undefined.
 */
export function applyDriverSeatOffset(
    driverSeatGroup: SeatGroupLike | null | undefined,
    cameraPosition: SeatCameraPosition | null | undefined,
    seatOffset: number,
): boolean {
    const position = driverSeatGroup?.position;
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
