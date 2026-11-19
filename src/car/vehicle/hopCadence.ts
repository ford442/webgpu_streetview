/**
 * Spacing between the extra panorama hops a 2/3 gear queues (manual or
 * cruise). Higher gears pack hops tighter, so the hop cadence (which the
 * vehicle model reads as a target speed) and the gear stay coupled.
 *
 * Hop cadence, not physics: the cruise/route layer owns it.
 */
export function gearChainedHopIntervalMs(hops: number): number {
    if (hops >= 3) return 400;
    if (hops >= 2) return 480;
    return 550;
}
