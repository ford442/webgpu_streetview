import { useEffect, useRef } from 'react';
import SunCalc from 'suncalc';

interface Coords { lat: number; lng: number; }

/**
 * Drives nightIntensity from real sun altitude at the current Street View location,
 * and exposes sun + moon positions for directional shading uniforms.
 *
 * Sun altitude → nightIntensity mapping:
 *   > 0.21 rad   → 0.0  (full daylight, ~12° above horizon)
 *   0.21 → -0.10 → lerp 0.0 → 0.5  (golden hour / civil twilight)
 *  -0.10 → -0.31 → lerp 0.5 → 1.0  (nautical / astronomical dusk)
 *   < -0.31      → 1.0  (full night)
 *
 * nightIntensity is smoothly lerped (max 0.002/tick at 250 ms) to prevent pops.
 * Sun/moon positions are reported directly on every recalculation (every 30 s + on coord change).
 *
 * @param coords       - Current lat/lng (updated on panorama change)
 * @param enabled      - Whether auto night mode is active
 * @param onNightIntensity - Called with the smoothed nightIntensity value (0-1)
 * @param onSunMoon    - Called with raw sun/moon azimuth + altitude (radians) immediately
 */
export function useAutoNight(
    coords: Coords,
    enabled: boolean,
    onNightIntensity: (value: number) => void,
    onSunMoon?: (
        sunAzimuth: number,
        sunAltitude: number,
        moonAzimuth: number,
        moonAltitude: number
    ) => void
): void {
    const targetRef  = useRef(0);
    const currentRef = useRef(0);

    const computeAndReport = (lat: number, lng: number): void => {
        const date = new Date();
        const sun  = SunCalc.getPosition(date, lat, lng);
        const moon = SunCalc.getMoonPosition(date, lat, lng);

        // Map sun altitude (radians) → nightIntensity target
        const alt = sun.altitude;
        let target: number;
        if (alt > 0.21)        target = 0.0;
        else if (alt > -0.10)  target = ((0.21 - alt) / 0.31) * 0.5;
        else if (alt > -0.31)  target = 0.5 + ((-0.10 - alt) / 0.21) * 0.5;
        else                   target = 1.0;
        targetRef.current = target;

        // Report astronomical positions immediately (directional shader uniforms)
        onSunMoon?.(sun.azimuth, sun.altitude, moon.azimuth, moon.altitude);
    };

    // Recompute immediately when coords or enabled change
    useEffect(() => {
        if (!enabled) return;
        computeAndReport(coords.lat, coords.lng);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coords.lat, coords.lng, enabled]);

    // Periodic recompute every 30 s (sun moves ~0.25°/min — faster is imperceptible)
    useEffect(() => {
        if (!enabled) return;
        const id = setInterval(() => computeAndReport(coords.lat, coords.lng), 30_000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coords.lat, coords.lng, enabled]);

    // Smooth lerp nightIntensity toward target (250 ms ticks, max 0.002 step/tick)
    useEffect(() => {
        if (!enabled) return;
        const id = setInterval(() => {
            const diff = targetRef.current - currentRef.current;
            if (Math.abs(diff) < 0.001) return;
            currentRef.current += Math.sign(diff) * Math.min(Math.abs(diff), 0.002);
            onNightIntensity(parseFloat(currentRef.current.toFixed(4)));
        }, 250);
        return () => clearInterval(id);
    }, [enabled, onNightIntensity]);
}
