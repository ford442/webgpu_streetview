import type { TimeOfDay } from '../hooks/useEnvironmentSettings';
import type { VehicleType } from '../car/VehicleManager';

/** Weather / vehicle keyframe on the director track (ms from recording start). */
export interface TourDirectorKeyframe {
  elapsedMs: number;
  timeOfDay?: TimeOfDay;
  vehicle?: VehicleType;
  /** Color-grading preset name (see applyColorGradingPreset). */
  colorGradingPreset?: string;
  rainIntensity?: number;
  snowIntensity?: number;
  fogDensity?: number;
}

export interface DirectorSnapshot {
  timeOfDay: TimeOfDay;
  vehicle: VehicleType;
  colorGradingPreset?: string;
  rainIntensity: number;
  snowIntensity: number;
  fogDensity: number;
}

const TIME_OF_DAYS: TimeOfDay[] = ['day', 'sunrise', 'sunset', 'night'];

export function isValidDirectorKeyframe(value: unknown): value is TourDirectorKeyframe {
  if (!value || typeof value !== 'object') return false;
  const k = value as Record<string, unknown>;
  if (typeof k.elapsedMs !== 'number' || !Number.isFinite(k.elapsedMs)) return false;
  if (k.timeOfDay !== undefined && !TIME_OF_DAYS.includes(k.timeOfDay as TimeOfDay)) return false;
  return true;
}

/** Pick the active keyframe at `elapsedMs` (last keyframe at or before the time). */
export function resolveDirectorAt(
  track: TourDirectorKeyframe[] | undefined,
  elapsedMs: number,
): TourDirectorKeyframe | null {
  if (!track?.length) return null;
  let active: TourDirectorKeyframe | null = null;
  for (const frame of track) {
    if (frame.elapsedMs <= elapsedMs) active = frame;
    else break;
  }
  return active;
}

/** Returns true when the snapshot differs materially from the last keyframe. */
export function shouldRecordDirectorKeyframe(
  last: TourDirectorKeyframe | null,
  snap: DirectorSnapshot,
  elapsedMs: number,
  minIntervalMs: number,
): boolean {
  if (!last) return true;
  if (elapsedMs - last.elapsedMs < minIntervalMs) {
    return (
      last.timeOfDay !== snap.timeOfDay ||
      last.vehicle !== snap.vehicle ||
      last.colorGradingPreset !== snap.colorGradingPreset
    );
  }
  // Interval elapsed — always sample so playback has timeline coverage.
  return true;
}

export function buildDirectorKeyframe(
  elapsedMs: number,
  snap: DirectorSnapshot,
): TourDirectorKeyframe {
  return {
    elapsedMs,
    timeOfDay: snap.timeOfDay,
    vehicle: snap.vehicle,
    colorGradingPreset: snap.colorGradingPreset,
    rainIntensity: snap.rainIntensity,
    snowIntensity: snap.snowIntensity,
    fogDensity: snap.fogDensity,
  };
}
