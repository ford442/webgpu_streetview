/**
 * The car → cabin-engine mapping: what the trip, the weather and live local
 * conditions sound like.
 */

import { describe, it, expect } from 'vitest';

import { cabinDspParams, PANEL_WIND_FULL_MPS, SOAKED_ROAD_MM } from './cabinParams';
import { CABIN_IR_VEHICLE_INDEX } from './cabinIr';
import type { VehicleTelemetry } from '../VehicleDynamics';

const telem = (over: Partial<VehicleTelemetry> = {}): VehicleTelemetry => ({
  speedKmh: 0,
  rpm: 850,
  gear: 'P',
  accelerating: false,
  ...over,
});

const calm = { rainIntensity: 0, wind: 0, wipersEnabled: false };

describe('cabinDspParams', () => {
  it('maps telemetry to rpm, load and m/s', () => {
    expect(cabinDspParams(telem(), { openness: 0 })).toMatchObject({ rpm: 850, load: 0.12, speedMps: 0 });
    expect(cabinDspParams(telem({ speedKmh: 90, rpm: 2600 }), { openness: 0 })).toMatchObject({
      rpm: 2600, load: 0.35, speedMps: 25,
    });
    expect(cabinDspParams(telem({ speedKmh: 30, accelerating: true }), { openness: 0 }).load).toBe(0.85);
  });

  it('follows the vehicle picker and the roof', () => {
    const p = cabinDspParams(telem(), { openness: 3, vehicle: 'limousine' });
    expect(p.vehicle).toBe(CABIN_IR_VEHICLE_INDEX.limousine);
    expect(p.openness).toBe(1);
    expect(cabinDspParams(telem(), { openness: -1 }).openness).toBe(0);
    expect(cabinDspParams(telem(), { openness: 0, vehicle: null }).vehicle).toBe(CABIN_IR_VEHICLE_INDEX.sedan);
  });

  it('a calm, dry day by default', () => {
    expect(cabinDspParams(telem(), { openness: 0 })).toMatchObject({
      rain: 0, wetRoad: 0, windMps: 0, wipers: false, radioGain: 1,
    });
  });

  it('rain wets the road early; live precipitation keeps it wet', () => {
    expect(cabinDspParams(telem(), { openness: 0 }, { ...calm, rainIntensity: 25 })).toMatchObject({
      rain: 0.25, wetRoad: 0.5,
    });
    expect(cabinDspParams(telem(), { openness: 0 }, { ...calm, rainIntensity: 80 }).wetRoad).toBe(1);
    // The panel's rain eased off, but it rained an hour ago.
    const live = cabinDspParams(telem(), { openness: 0 }, { ...calm, livePrecipitationMm: SOAKED_ROAD_MM / 2 });
    expect(live).toMatchObject({ rain: 0, wetRoad: 0.5 });
  });

  it('wind is the panel magnitude or the live wind, whichever is stronger', () => {
    expect(cabinDspParams(telem(), { openness: 0 }, { ...calm, wind: -50 }).windMps).toBe(PANEL_WIND_FULL_MPS / 2);
    expect(cabinDspParams(telem(), { openness: 0 }, { ...calm, wind: 10, liveWindKmh: 36 }).windMps).toBe(10);
  });

  it('a routed trip\'s cruise pace is the floor for the road speed', () => {
    expect(cabinDspParams(telem({ speedKmh: 18 }), { openness: 0 }, { ...calm, tripSpeedMps: 14 }).speedMps).toBe(14);
    expect(cabinDspParams(telem({ speedKmh: 72 }), { openness: 0 }, { ...calm, tripSpeedMps: 14 }).speedMps).toBe(20);
    expect(cabinDspParams(telem({ speedKmh: 72 }), { openness: 0 }, { ...calm, tripSpeedMps: null }).speedMps).toBe(20);
  });

  it('carries the wipers switch', () => {
    expect(cabinDspParams(telem(), { openness: 0 }, { ...calm, wipersEnabled: true }).wipers).toBe(true);
  });

  it('non-finite inputs never reach the engine', () => {
    const p = cabinDspParams(
      telem({ speedKmh: Number.NaN, rpm: Number.POSITIVE_INFINITY }),
      { openness: Number.NaN },
      { rainIntensity: Number.NaN, wind: Number.NaN, wipersEnabled: false, liveWindKmh: Number.NaN, tripSpeedMps: Number.NaN },
    );
    for (const v of [p.rpm, p.speedMps, p.openness, p.rain, p.wetRoad, p.windMps]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
