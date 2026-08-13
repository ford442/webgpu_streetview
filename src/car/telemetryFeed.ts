/**
 * Single writer for vehicle gauges: one VehicleTelemetry snapshot feeds both
 * the DOM HUD and the 3D instrument cluster. Neither surface should invent
 * speed/RPM/gear on its own.
 */
import { SPEED_DIAL_MAX_KMH, TACHO_DIAL_MAX_RPM } from './interior/CarInteriorGauges';
import type { VehicleTelemetry } from './VehicleDynamics';

export interface HudTelemetry {
  speedKmh: number;
  rpm: number;
  gear: string;
  accelerating: boolean;
}

export interface ClusterNeedleTargets {
  speedFrac: number;
  rpmFrac: number;
  gear: string;
}

/** HUD copy of a telemetry snapshot (identity — DOM must not rescale). */
export function telemetryToHud(telem: VehicleTelemetry): HudTelemetry {
  return {
    speedKmh: telem.speedKmh,
    rpm: telem.rpm,
    gear: telem.gear,
    accelerating: telem.accelerating,
  };
}

/** 3D cluster needle fractions derived from the same snapshot. */
export function telemetryToCluster(telem: VehicleTelemetry): ClusterNeedleTargets {
  return {
    speedFrac: Math.max(0, Math.min(1, telem.speedKmh / SPEED_DIAL_MAX_KMH)),
    rpmFrac: Math.max(0, Math.min(1, telem.rpm / TACHO_DIAL_MAX_RPM)),
    gear: telem.gear,
  };
}

export interface TelemetrySinks {
  /** Push km/h + RPM into the Three.js cluster (needles + center display). */
  updateCluster: (speedKmh: number, rpm: number) => void;
}

/**
 * The only production writer for live gauges. Callers pass the dynamics
 * snapshot once; both the 3D cluster and the returned HUD payload stay in lockstep.
 */
export function applyVehicleTelemetry(
  telem: VehicleTelemetry,
  sinks: TelemetrySinks,
): HudTelemetry {
  sinks.updateCluster(telem.speedKmh, telem.rpm);
  return telemetryToHud(telem);
}
