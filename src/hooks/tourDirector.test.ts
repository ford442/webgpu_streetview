import { describe, it, expect } from 'vitest';
import {
  buildDirectorKeyframe,
  resolveDirectorAt,
  shouldRecordDirectorKeyframe,
  type DirectorSnapshot,
} from './tourDirector';

const baseSnap: DirectorSnapshot = {
  timeOfDay: 'day',
  vehicle: 'sedan',
  rainIntensity: 0,
  snowIntensity: 0,
  fogDensity: 0,
};

describe('tourDirector', () => {
  it('resolveDirectorAt returns last keyframe at or before elapsedMs', () => {
    const track = [
      buildDirectorKeyframe(0, { ...baseSnap, timeOfDay: 'day' }),
      buildDirectorKeyframe(5000, { ...baseSnap, timeOfDay: 'sunset' }),
      buildDirectorKeyframe(10000, { ...baseSnap, timeOfDay: 'night' }),
    ];
    expect(resolveDirectorAt(track, 0)?.timeOfDay).toBe('day');
    expect(resolveDirectorAt(track, 4999)?.timeOfDay).toBe('day');
    expect(resolveDirectorAt(track, 5000)?.timeOfDay).toBe('sunset');
    expect(resolveDirectorAt(track, 99999)?.timeOfDay).toBe('night');
  });

  it('shouldRecordDirectorKeyframe respects min interval unless tod/vehicle changes', () => {
    const last = buildDirectorKeyframe(0, baseSnap);
    const changed = { ...baseSnap, timeOfDay: 'night' as const };
    expect(shouldRecordDirectorKeyframe(last, changed, 500, 2000)).toBe(true);
    expect(shouldRecordDirectorKeyframe(last, baseSnap, 500, 2000)).toBe(false);
    expect(shouldRecordDirectorKeyframe(last, baseSnap, 2500, 2000)).toBe(true);
  });
});
