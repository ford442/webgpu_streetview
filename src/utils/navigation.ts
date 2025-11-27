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
