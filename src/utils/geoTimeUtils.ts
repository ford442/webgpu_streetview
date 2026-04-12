/**
 * geoTimeUtils.ts
 *
 * Utilities for computing the local time-of-day at a given geographic
 * coordinate, used for auto-lighting when teleporting.
 * Uses SunCalc (already in package.json) for sun position calculations.
 */

import SunCalc from 'suncalc';

export type TimeOfDayPreset = 'day' | 'sunset' | 'night';

/**
 * Determine the time-of-day preset for a geographic location
 * based on the current real-world sun position there.
 *
 * Sun altitude thresholds (radians):
 *   > 0.105 rad (6°)  → 'day'       (sun well above horizon)
 *   > -0.018 rad (-1°) → 'sunset'   (golden hour / civil twilight)
 *   ≤ -0.018 rad       → 'night'    (below horizon)
 */
export function getTimeOfDayForLocation(lat: number, lng: number): TimeOfDayPreset {
    const now = new Date();
    const sun = SunCalc.getPosition(now, lat, lng);
    const alt = sun.altitude; // radians

    if (alt > 0.105) return 'day';       // ~6° above horizon
    if (alt > -0.018) return 'sunset';   // ~-1° (golden hour → dusk)
    return 'night';
}

/**
 * Get a color grading preset name that matches the time of day.
 * Maps to existing presets in useEnvironmentSettings.
 */
export function getColorPresetForTimeOfDay(preset: TimeOfDayPreset): string {
    switch (preset) {
        case 'day': return 'daylight';
        case 'sunset': return 'golden';
        case 'night': return 'night';
        default: return 'daylight';
    }
}

/**
 * Get approximate local solar time offset in hours from UTC.
 * This is a rough estimate based on longitude (15° per hour).
 */
export function getSolarTimeOffset(lng: number): number {
    return lng / 15;
}

/**
 * Get approximate local time at a location (solar time, not timezone-based).
 */
export function getApproxLocalTime(lng: number): Date {
    const now = new Date();
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
    const solarOffset = getSolarTimeOffset(lng);
    const localHours = (utcHours + solarOffset + 24) % 24;
    
    const localDate = new Date(now);
    localDate.setUTCHours(Math.floor(localHours));
    localDate.setUTCMinutes((localHours % 1) * 60);
    return localDate;
}
