import type { PanoLocationInfo } from '../../utils/panoLocation';
import { getState } from './state';

/**
 * One-way feeds from the app into the cabin: where the car is, what the sky is
 * doing, what the gauges and lamps read, what is on the centre display.
 *
 * Every function here is a guarded delegate to `CarInterior` — no state of its
 * own. They are grouped because they share that shape, not because they share
 * a subsystem.
 */

/**
 * Update the dashboard location readout with the current panorama's metadata.
 */
export function setCarLocationInfo(info: PanoLocationInfo | null): void {
    const state = getState();
    if (!state) return;
    state.interior.setLocationInfo(info);
}

/**
 * Update the live compass heading shown on the location readout panel.
 */
export function setCarCompassHeading(heading: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setCompassHeading(heading);
}

/**
 * Rebuild the cabin's IBL environment from the current panorama.
 * @param equirect - 2:1 equirect image of the pano (low-res is fine; it gets PMREM-filtered)
 * @param centerHeading - Compass heading at the horizontal centre of the image
 */
export function setCarPanoEnvironment(equirect: HTMLCanvasElement, centerHeading: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setEnvironmentFromPano(equirect, centerHeading);
}

/**
 * Aim the cabin's sun light at the real sun for the pano's location/time.
 * @param azimuth  - SunCalc azimuth in radians (0 = south, positive west)
 * @param altitude - SunCalc altitude in radians (0 = horizon)
 */
export function setCarSunPosition(azimuth: number, altitude: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setSunPosition(azimuth, altitude);
}

/**
 * Update dashboard gauges (speedometer, tachometer).
 * @param speed - Speed in km/h (0-100)
 * @param rpm - Engine RPM (0-8000)
 */
export function updateCarGauges(speed: number, rpm: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setGaugeValues(speed, rpm);
}

/**
 * Toggle car headlights.
 */
export function toggleCarHeadlights(): boolean {
    const state = getState();
    if (!state) return false;
    state.interior.toggleHeadlights();
    return state.interior.getHeadlightsState();
}

/**
 * Toggle the car's dome (interior cabin) light.
 * Returns the new dome light state.
 */
export function toggleCarDomeLight(): boolean {
    const state = getState();
    if (!state) return false;
    return state.interior.toggleDomeLight();
}

/**
 * Set car headlights to a specific state.
 */
export function setCarHeadlights(on: boolean): void {
    const state = getState();
    if (!state) return;
    state.interior.setHeadlights(on);
}

/**
 * Set the car's dome (interior cabin) light to a specific state.
 */
export function setCarDomeLight(on: boolean): void {
    const state = getState();
    if (!state) return;
    state.interior.setDomeLight(on);
}

/**
 * Get the current dome light state.
 */
export function getCarDomeLightState(): boolean {
    const state = getState();
    if (!state) return false;
    return state.interior.getDomeLightState();
}

/**
 * Update the media page on the centre display (radio station name/tags/state).
 */
export function setCarMediaInfo(name: string, tags: string, playing: boolean): void {
    const state = getState();
    if (!state) return;
    state.interior.setMediaInfo(name, tags, playing);
}

/**
 * Toggle rain droplets on the windshield.
 */
export function setCarRainActive(active: boolean): void {
    const state = getState();
    if (!state) return;
    state.interior.setRainActive(active);
}

/** Weather-driven cabin glass + ambience (rain overlay, condensation, dust, wind). */
export function setCarWeatherAmbient(opts: {
    rainIntensity: number;
    wind: number;
    fogDensity: number;
    snowIntensity?: number;
    sunAltitude?: number;
    lightShaftFactor?: number;
    convertibleOpen?: boolean;
}): void {
    const state = getState();
    if (!state) return;
    state.interior.setWeatherAmbient(opts);
}

/**
 * Set 0-1 rain intensity: dims and diffuses the cabin daylight, suppresses
 * the low-sun window shafts, and drives the windshield droplet system.
 */
export function setCarWeather(rain: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setWeatherIntensity(rain);
}

/**
 * Enable/disable post-processing (bloom + SMAA).
 */
export function setCarPostProcessingEnabled(enabled: boolean): void {
    const state = getState();
    if (!state) return;
    state.interior.setPostProcessingEnabled(enabled);
}

/**
 * Adjust bloom strength (0-1).
 */
export function setCarBloomStrength(strength: number): void {
    const state = getState();
    if (!state) return;
    state.interior.setBloomStrength(strength);
}

/**
 * Get current performance metrics string for debug overlay.
 */
export function getCarPerformanceString(): string {
    const state = getState();
    if (!state) return '';
    return state.interior.getPerformanceString();
}
