import { describe, expect, it } from 'vitest';
import { VehicleDynamics, gearChainedHopIntervalMs } from '../VehicleDynamics';

describe('VehicleDynamics', () => {
  it('parks when the cabin gear is P', () => {
    const dyn = new VehicleDynamics();
    dyn.noteThrust('forward');
    for (let i = 0; i < 20; i++) dyn.update(0.05);
    dyn.noteGear('P');
    for (let i = 0; i < 50; i++) dyn.update(0.05);
    const parked = dyn.update(0.05);
    expect(parked.gear).toBe('P');
    expect(parked.speedKmh).toBeLessThan(1);
  });

  it('tightens chained hop spacing in higher gears', () => {
    expect(gearChainedHopIntervalMs(1)).toBe(550);
    expect(gearChainedHopIntervalMs(2)).toBeLessThan(gearChainedHopIntervalMs(1));
    expect(gearChainedHopIntervalMs(3)).toBeLessThan(gearChainedHopIntervalMs(2));
  });
});
