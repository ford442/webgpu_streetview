import { describe, expect, it } from 'vitest';
import { SPEED_DIAL_MAX_KMH, TACHO_DIAL_MAX_RPM, needleAngle } from '../interior/CarInteriorGauges';
import {
  applyVehicleTelemetry,
  telemetryToCluster,
  telemetryToHud,
} from '../telemetryFeed';
import type { VehicleTelemetry } from '../VehicleDynamics';

const SAMPLE: VehicleTelemetry = {
  speedKmh: 47.7,
  rpm: 2100,
  gear: 'D',
  accelerating: true,
};

describe('telemetry SSOT', () => {
  it('HUD and 3D cluster cannot disagree on a snapshot', () => {
    const hud = telemetryToHud(SAMPLE);
    const cluster = telemetryToCluster(SAMPLE);

    expect(hud.speedKmh).toBe(SAMPLE.speedKmh);
    expect(hud.rpm).toBe(SAMPLE.rpm);
    expect(hud.gear).toBe(SAMPLE.gear);
    expect(cluster.gear).toBe(hud.gear);

    expect(cluster.speedFrac * SPEED_DIAL_MAX_KMH).toBeCloseTo(SAMPLE.speedKmh, 5);
    expect(cluster.rpmFrac * TACHO_DIAL_MAX_RPM).toBeCloseTo(SAMPLE.rpm, 5);
  });

  it('applyVehicleTelemetry is the single writer into the cluster', () => {
    const writes: Array<{ speed: number; rpm: number }> = [];
    const hud = applyVehicleTelemetry(SAMPLE, {
      updateCluster: (speedKmh, rpm) => writes.push({ speed: speedKmh, rpm }),
    });
    expect(writes).toEqual([{ speed: SAMPLE.speedKmh, rpm: SAMPLE.rpm }]);
    expect(hud.speedKmh).toBe(writes[0]!.speed);
    expect(hud.rpm).toBe(writes[0]!.rpm);
  });

  it('needle angle is a pure function of the cluster fraction', () => {
    const cluster = telemetryToCluster(SAMPLE);
    const zero = needleAngle(0);
    const full = needleAngle(1);
    const mid = needleAngle(cluster.speedFrac);
    expect(mid).toBeLessThan(zero);
    expect(mid).toBeGreaterThan(full);
  });
});
