/**
 * Live-conditions shapes shared by `services/conditions` and the `state/` stores that hold them (#368).
 */

export interface LiveConditions {
  lat: number;
  lng: number;
  fetchedAt: number;
  /** WMO weather interpretation code. */
  weatherCode: number;
  /** Precipitation over the preceding hour, mm. */
  precipitationMm: number;
  /** Snowfall over the preceding hour, cm. */
  snowfallCm: number;
  cloudCoverPct: number;
  /** Metres; null when the model does not report it. */
  visibilityM: number | null;
  windSpeedKmh: number;
  /** Direction the wind blows *from*, degrees. */
  windFromDeg: number;
  temperatureC: number | null;
}


/** Targets in the weather panel's own units (rain/snow/fog 0–100, wind −100…100). */
export interface WeatherTarget {
  rainIntensity: number;
  snowIntensity: number;
  fogDensity: number;
  wind: number;
}
