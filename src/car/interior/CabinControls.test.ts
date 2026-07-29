import { describe, it, expect } from 'vitest';
import {
  GEAR_POSITIONS,
  SHIFTER_DETENTS,
  WIPER_STALK_DETENTS,
  WIPER_STALK_POSITIONS,
  WIPER_STALK_SPEEDS,
  gearHopCount,
  isGearParked,
} from './CabinControls';

describe('CabinControls', () => {
  it('has one detent angle per lever position', () => {
    expect(WIPER_STALK_DETENTS).toHaveLength(WIPER_STALK_POSITIONS.length);
    expect(SHIFTER_DETENTS).toHaveLength(GEAR_POSITIONS.length);
  });

  it('orders wiper detents monotonically from off to high', () => {
    for (let i = 1; i < WIPER_STALK_DETENTS.length; i++) {
      expect(WIPER_STALK_DETENTS[i]!).toBeLessThan(WIPER_STALK_DETENTS[i - 1]!);
    }
  });

  it('speeds up as the stalk moves toward high', () => {
    const speeds = WIPER_STALK_POSITIONS.map((p) => WIPER_STALK_SPEEDS[p]);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!);
    }
    // Animator clamps to [0.5, 2.0]; staying inside keeps detents distinguishable.
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(2.0);
  });

  it('maps gears to advance hop counts', () => {
    expect(gearHopCount('D')).toBe(1);
    expect(gearHopCount('2')).toBe(2);
    expect(gearHopCount('3')).toBe(3);
    expect(gearHopCount('R')).toBe(1);
  });

  it('treats P and N as parked', () => {
    expect(isGearParked('P')).toBe(true);
    expect(isGearParked('N')).toBe(true);
    expect(isGearParked('R')).toBe(false);
    expect(isGearParked('D')).toBe(false);
  });
});
