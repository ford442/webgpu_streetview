export function findBestLink(
    links: google.maps.StreetViewLink[],
    currentHeading: number,
    direction: 'forward' | 'backward' | 'left' | 'right'
): google.maps.StreetViewLink | null {
    if (!links || links.length === 0) {
        return null;
    }

    let targetHeading: number;
    switch (direction) {
        case 'forward':
            targetHeading = currentHeading;
            break;
        case 'backward':
            targetHeading = (currentHeading + 180) % 360;
            break;
        case 'left':
            targetHeading = (currentHeading - 90 + 360) % 360;
            break;
        case 'right':
            targetHeading = (currentHeading + 90) % 360;
            break;
    }

    let bestLink: google.maps.StreetViewLink | null = null;
    let smallestAngleDiff = Infinity;

    for (const link of links) {
        if (link.heading == null) continue;
        const linkHeading = link.heading;

        let angleDiff = Math.abs(targetHeading - linkHeading);
        if (angleDiff > 180) {
            angleDiff = 360 - angleDiff;
        }

        if (angleDiff < smallestAngleDiff) {
            smallestAngleDiff = angleDiff;
            bestLink = link;
        }
    }

    // Only return a link if it's reasonably close to the target direction
    // to avoid moving in a completely wrong direction.
    if (smallestAngleDiff < 45) {
        return bestLink;
    }

    return null;
}

/**
 * Normalize angle to [0, 360)
 * Handles negative angles and angles >= 360
 */
export function normalizeAngle(angle: number): number {
    return ((angle % 360) + 360) % 360;
}

/**
 * Calculate the shortest signed angular difference [-180, 180]
 * Positive means rotate clockwise, negative means rotate counter-clockwise
 */
export function signedAngleDiff(target: number, current: number): number {
    let diff = ((target - current + 180) % 360) - 180;
    return diff < -180 ? diff + 360 : diff;
}

/**
 * Calculate the shortest absolute angular distance [0, 180]
 * Always returns a non-negative value representing the minimum rotation needed
 */
export function absoluteAngleDiff(a: number, b: number): number {
    const diff = Math.abs(a - b);
    return Math.min(diff, 360 - diff);
}

/**
 * Calculate great-circle distance between two lat/lng points using the haversine formula
 * @param lat1 - Latitude of first point in degrees
 * @param lon1 - Longitude of first point in degrees
 * @param lat2 - Latitude of second point in degrees
 * @param lon2 - Longitude of second point in degrees
 * @param unit - Unit for result: 'km' (default), 'mi' (miles), or 'nm' (nautical miles)
 * @returns Distance in specified unit
 */
export function haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number,
    unit: 'km' | 'mi' | 'nm' = 'km'
): number {
    const R = { km: 6371, mi: 3959, nm: 3440 }[unit];
    const toRad = (deg: number) => deg * Math.PI / 180;
    
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
}

/**
 * Calculate initial bearing (forward azimuth) from point 1 to point 2
 * @param lat1 - Latitude of starting point in degrees
 * @param lon1 - Longitude of starting point in degrees
 * @param lat2 - Latitude of destination point in degrees
 * @param lon2 - Longitude of destination point in degrees
 * @returns Initial bearing in degrees [0, 360), where 0 is North, 90 is East
 */
export function initialBearing(
    lat1: number, lon1: number,
    lat2: number, lon2: number
): number {
    const toRad = (deg: number) => deg * Math.PI / 180;
    const toDeg = (rad: number) => rad * 180 / Math.PI;
    
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    const θ = Math.atan2(y, x);
    return (toDeg(θ) + 360) % 360;
}
