/**
 * What the car is doing → the cabin engine's targets (`dsp_set_params`).
 *
 * Pure, so the mapping is testable without Web Audio: `useCarDashboardBridge`
 * gathers the inputs once per frame (telemetry, roof/vehicle, the weather
 * panel, live local conditions, the routed trip) and `CabinAudio` posts the
 * result to the worklet. The engine smooths every target itself, so nothing
 * here needs to ramp.
 */

import type { CabinDspParams } from '../../wasm';
import type { VehicleTelemetry } from '../VehicleDynamics';
import type { VehicleType } from '../VehicleManager';
import { cabinIrVehicleIndex } from './cabinIr';

/** The world outside the cabin, as far as the audio cares. */
export interface CabinEnvironment {
  /** Weather panel rain, 0–100 (live conditions drive it too while live). */
  rainIntensity: number;
  /** Weather panel wind, −100…100 (the sign is direction; only the magnitude is heard). */
  wind: number;
  wipersEnabled: boolean;
  /** Live conditions' precipitation over the last hour, mm — null unless live. */
  livePrecipitationMm?: number | null;
  /** Live conditions' wind speed, km/h — null unless live. */
  liveWindKmh?: number | null;
  /** The routed trip's measured cruise pace, m/s — null unless a trip is driving. */
  tripSpeedMps?: number | null;
}

export const CALM_CABIN_ENVIRONMENT: CabinEnvironment = {
  rainIntensity: 0,
  wind: 0,
  wipersEnabled: false,
};

/** Weather-panel wind at |100|, in m/s (a gale; the engine's band saturates at 40 m/s airspeed). */
export const PANEL_WIND_FULL_MPS = 20;
/** Live precipitation that soaks the road completely, mm/h. */
export const SOAKED_ROAD_MM = 2;

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
const finiteOr = (v: number | null | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function cabinDspParams(
  telem: VehicleTelemetry,
  occlusion: { openness: number; vehicle?: VehicleType | null },
  env: CabinEnvironment = CALM_CABIN_ENVIRONMENT,
): CabinDspParams {
  const speedKmh = Math.max(0, finiteOr(telem.speedKmh, 0));
  const rain = clamp01(finiteOr(env.rainIntensity, 0) / 100);
  const livePrecip = Math.max(0, finiteOr(env.livePrecipitationMm, 0));
  // Between pano hops the car's own speed can sag; on a routed trip the
  // measured cruise pace is the speed the road actually goes by at.
  const tripSpeed = Math.max(0, finiteOr(env.tripSpeedMps, 0));
  return {
    rpm: Math.max(0, finiteOr(telem.rpm, 0)),
    load: telem.accelerating ? 0.85 : speedKmh > 1 ? 0.35 : 0.12,
    speedMps: Math.max(speedKmh / 3.6, tripSpeed),
    openness: clamp01(finiteOr(occlusion.openness, 0)),
    vehicle: cabinIrVehicleIndex(occlusion.vehicle),
    // A road is wet long before the rain is heavy; live precipitation keeps
    // it wet after the weather panel's rain eases off.
    wetRoad: clamp01(Math.max(rain * 2, livePrecip / SOAKED_ROAD_MM)),
    rain,
    windMps: Math.max(
      (Math.abs(finiteOr(env.wind, 0)) / 100) * PANEL_WIND_FULL_MPS,
      Math.max(0, finiteOr(env.liveWindKmh, 0)) / 3.6,
    ),
    // The station level (volume, retune crossfade) stays on the radio's own
    // gain node; this is the cabin's fixed send.
    radioGain: 1,
    wipers: env.wipersEnabled,
  };
}
