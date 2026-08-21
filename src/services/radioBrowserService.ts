/**
 * RadioBrowserService — queries the open-source Radio Browser API
 * for internet radio stations near a geographic location.
 * 
 * API docs: https://de1.api.radio-browser.info/
 */

export interface RadioStation {
    id: string;
    name: string;
    url: string;
    urlResolved: string;
    country: string;
    state: string;
    language: string;
    tags: string;
    codec: string;
    bitrate: number;
    votes: number;
    favicon: string;
}

const API_BASE = 'https://de1.api.radio-browser.info/json';

/**
 * Fetch globally popular radio stations as a fallback when country code
 * cannot be determined from coordinates. The lat/lng parameters are retained
 * in the signature for API consistency with getTopStationForLocation but are
 * not used for filtering (Radio Browser API has no direct geo-coordinate search).
 */
export async function fetchNearbyStations(
    _lat: number,
    _lng: number,
    limit: number = 10
): Promise<RadioStation[]> {
    try {
        const response = await fetch(
            `${API_BASE}/stations/search?limit=${limit}&order=votes&reverse=true&has_extended_info=true&offset=0`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `limit=${limit}&order=votes&reverse=true`,
            }
        );

        if (!response.ok) {
            console.warn(`[RadioBrowser] API returned ${response.status}`);
            return [];
        }

        const data = await response.json();
        return mapStations(data);
    } catch (err) {
        console.warn('[RadioBrowser] Failed to fetch stations:', err);
        return [];
    }
}

/**
 * Fetch radio stations by country code (ISO 3166-1 alpha-2).
 */
export async function fetchStationsByCountry(
    countryCode: string,
    limit: number = 10
): Promise<RadioStation[]> {
    try {
        const response = await fetch(
            `${API_BASE}/stations/bycountrycodeexact/${countryCode}?limit=${limit}&order=votes&reverse=true`
        );

        if (!response.ok) return [];
        const data = await response.json();
        return mapStations(data);
    } catch (err) {
        console.warn('[RadioBrowser] Country search failed:', err);
        return [];
    }
}

/**
 * Approximate country code from lat/lng using simple geographic bounds.
 * This is a rough approximation — does not require a geocoding API.
 * 
 * Limitations: Only covers major continental landmasses. Island territories
 * (e.g. Hawaii, Caribbean), overlapping boundaries, and many smaller countries
 * will return '' (empty), causing a fallback to global popular stations.
 */
export function approximateCountryCode(lat: number, lng: number): string {
    // Very rough geographic region mapping — covers major landmasses only
    if (lat > 24 && lat < 50 && lng > -125 && lng < -66) return 'US';
    if (lat > 41 && lat < 56 && lng > -8 && lng < 2) return 'GB';
    if (lat > 42 && lat < 51 && lng > -5 && lng < 8) return 'FR';
    if (lat > 47 && lat < 55 && lng > 6 && lng < 15) return 'DE';
    if (lat > 36 && lat < 47 && lng > 6 && lng < 19) return 'IT';
    if (lat > 36 && lat < 44 && lng > -10 && lng < 4) return 'ES';
    if (lat > 36 && lat < 42 && lng > 19 && lng < 30) return 'GR';
    if (lat > 49 && lat < 62 && lng > 3 && lng < 32) return 'SE';
    if (lat > 24 && lat < 46 && lng > 100 && lng < 147) return 'JP';
    if (lat > -44 && lat < -10 && lng > 113 && lng < 154) return 'AU';
    if (lat > 42 && lat < 72 && lng > -141 && lng < -52) return 'CA';
    if (lat > -34 && lat < 6 && lng > -74 && lng < -35) return 'BR';
    if (lat > 8 && lat < 37 && lng > 68 && lng < 97) return 'IN';
    if (lat > 18 && lat < 54 && lng > 73 && lng < 135) return 'CN';
    if (lat > 33 && lat < 38 && lng > 124 && lng < 132) return 'KR';
    if (lat > 49 && lat < 52 && lng > 14 && lng < 24) return 'PL';
    if (lat > 46 && lat < 49 && lng > 6 && lng < 17) return 'AT';
    // Default: empty (will search globally)
    return '';
}

/**
 * Get a top-rated station for a location — main entry point for auto-tuning.
 */
export async function getTopStationForLocation(
    lat: number,
    lng: number
): Promise<RadioStation | null> {
    const countryCode = approximateCountryCode(lat, lng);
    
    let stations: RadioStation[];
    if (countryCode) {
        stations = await fetchStationsByCountry(countryCode, 5);
    } else {
        stations = await fetchNearbyStations(lat, lng, 5);
    }
    
    if (stations.length === 0) return null;
    
    // Pick the highest-voted station with a resolved URL.
    // stations.length === 0 already returned above, so index 0 is always present.
    const best = stations.find(s => s.urlResolved) || stations[0]!;
    return best;
}

function asString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isStationRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Map Radio Browser JSON to RadioStation. Unknown / malformed entries become empty fields. */
export function mapStations(data: unknown): RadioStation[] {
    if (!Array.isArray(data)) return [];
    return data.filter(isStationRecord).map((s) => ({
        id: asString(s.stationuuid) || asString(s.id),
        name: asString(s.name, 'Unknown Station'),
        url: asString(s.url),
        urlResolved: asString(s.url_resolved) || asString(s.url),
        country: asString(s.country),
        state: asString(s.state),
        language: asString(s.language),
        tags: asString(s.tags),
        codec: asString(s.codec),
        bitrate: asNumber(s.bitrate),
        votes: asNumber(s.votes),
        favicon: asString(s.favicon),
    }));
}
