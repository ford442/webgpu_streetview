import { useEffect, useRef } from 'react';
import SunCalc from 'suncalc';

interface Coords { lat: number; lng: number; }

/**
 * Drives nightIntensity from real sun altitude at the current Street View location,
 * and exposes sun + moon positions for directional shading uniforms.
 *
 * Moon lighting is now calculated scientifically:
 * - Moon phase (illumination fraction) from SunCalc.getMoonIllumination()
 * - Altitude attenuation: sin(moonAltitude) when above horizon
 * - Opposition surge: +50% brightness boost at full moon
 * - Full moon reduces nightIntensity to 0.85 (brighter nights)
 * - New moon keeps nightIntensity at 1.0 (darkest nights)
 *
 * Sun altitude → base nightIntensity mapping:
 *   > 0.0 rad    → 0.0  (full daylight, sun above horizon)
 *   0.0 → -0.105 → lerp 0.0 → 0.5  (sunset / civil twilight, -6°)
 *  -0.105 → -0.314 → lerp 0.5 → 1.0  (nautical / astronomical dusk, -18°)
 *   < -0.314     → 1.0  (full night)
 *
 * nightIntensity is smoothly lerped (max 0.002/tick at 250 ms) to prevent pops.
 * Sun/moon positions are reported directly on every recalculation (every 30 s + on coord change).
 *
 * @param coords       - Current lat/lng (updated on panorama change)
 * @param enabled      - Whether auto night mode is active
 * @param onNightIntensity - Called with the smoothed nightIntensity value (0-1)
 * @param onSunMoon    - Called with raw sun/moon azimuth + altitude (radians) and moonIntensity
 */
export function useAutoNight(
    coords: Coords,
    enabled: boolean,
    onNightIntensity: (value: number) => void,
    onSunMoon?: (
        sunAzimuth: number,
        sunAltitude: number,
        moonAzimuth: number,
        moonAltitude: number,
        moonIntensity: number
    ) => void
): void {
    const targetRef  = useRef(0);
    const currentRef = useRef(0);

    const computeAndReport = (lat: number, lng: number): void => {
        const date = new Date();
        const sun  = SunCalc.getPosition(date, lat, lng);
        const moon = SunCalc.getMoonPosition(date, lat, lng);
        const moonIllumination = SunCalc.getMoonIllumination(date);
        const moonPhase = moonIllumination.fraction; // 0.0-1.0 illuminated

        // Map sun altitude (radians) → base nightIntensity target
        const alt = sun.altitude;
        let baseTarget: number;
        if (alt > 0.0)         baseTarget = 0.0;
        else if (alt > -0.105) baseTarget = ((0.0 - alt) / 0.105) * 0.5;
        else if (alt > -0.314) baseTarget = 0.5 + ((-0.105 - alt) / 0.209) * 0.5;
        else                   baseTarget = 1.0;

        // Calculate moon light contribution
        // Altitude attenuation: sin(moonAltitude) when above horizon
        const moonAltitudeFactor = moon.altitude > 0 ? Math.sin(moon.altitude) : 0;
        
        // Opposition surge: +50% brightness boost at full moon (phase = 1.0)
        // This simulates the retroreflective properties of the lunar surface
        // where the full moon appears brighter than just the illumination fraction
        const oppositionSurge = 1.0 + 0.5 * moonPhase;
        
        // Moon intensity: phase * altitude * opposition surge
        // Only contributes when moon is above horizon
        const moonIntensity = moonPhase * moonAltitudeFactor * oppositionSurge;

        // Adjust nightIntensity based on moonlight
        // Full moon (moonIntensity ~1.5) reduces nightIntensity to 0.85
        // New moon (moonIntensity = 0) keeps nightIntensity at 1.0
        let target: number;
        if (baseTarget < 1.0) {
            // During twilight, no moonlight adjustment needed
            target = baseTarget;
        } else {
            // Full night: apply moonlight reduction
            // moonIntensity ranges from 0 to ~1.5 (full moon at zenith with opposition surge)
            // Scale it to 0-1 range for the lerp, capping at 1.5
            const moonBrightnessFactor = Math.min(moonIntensity / 1.5, 1.0);
            // Full moon reduces nightIntensity from 1.0 to 0.85 (15% reduction)
            target = 1.0 - (moonBrightnessFactor * 0.15);
        }
        targetRef.current = target;

        // Report astronomical positions immediately (directional shader uniforms)
        onSunMoon?.(sun.azimuth, sun.altitude, moon.azimuth, moon.altitude, moonIntensity);
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
