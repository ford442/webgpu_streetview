/**
 * The vehicle model through the committed WASM binary (setupTests.ts installs
 * it): each variant's performance against its parameter sheet
 * (docs/VEHICLE.md), and the car loop's handle (VehicleSim) — the
 * accumulator, the hop-derived target and the shifter.
 */
import { describe, expect, it } from 'vitest';
import { requireWasm } from '../../wasm';
import { VEHICLE_STEP_S, VehicleSim, vehicleVariant } from './vehicleSim';

/** docs/VEHICLE.md: 0–100 km/h at full pedal, 100–0 km/h at full brake (s). */
const SHEET = [
  { variant: 0, name: 'sedan', zeroTo100: 8.5, hundredTo0: 3.1 },
  { variant: 1, name: 'sports', zeroTo100: 4.7, hundredTo0: 2.8 },
  { variant: 2, name: 'limousine', zeroTo100: 10.2, hundredTo0: 3.5 },
  { variant: 3, name: 'van', zeroTo100: 17.5, hundredTo0: 3.9 },
] as const;

/** Seconds until `done(telemetry)` holds, stepping one fixed step at a time. */
function timeUntil(
  variant: number, speedMps: number, inputs: number[], done: (t: Float64Array) => boolean, limitS = 40,
): number {
  const wasm = requireWasm();
  const params = wasm.vehicleParams(variant);
  const state = wasm.vehicleReset(params, speedMps, 3, 1);
  const block = Float64Array.from(inputs);
  const t = new Float64Array(24);
  for (let step = 1; step <= limitS / VEHICLE_STEP_S; step++) {
    wasm.vehicleStep(params, state, block, VEHICLE_STEP_S, 1);
    if (done(wasm.vehicleTelemetry(params, state, t))) return step * VEHICLE_STEP_S;
  }
  return Number.POSITIVE_INFINITY;
}

describe('vehicle performance vs the parameter sheet (within 5 %)', () => {
  for (const sheet of SHEET) {
    it(`${sheet.name}: 0–100 km/h in ${sheet.zeroTo100} s`, () => {
      const s = timeUntil(sheet.variant, 0, [1, 0, 1, 0, 3, 0, 0, 0], (t) => t[1]! >= 100);
      expect(Math.abs(s - sheet.zeroTo100) / sheet.zeroTo100).toBeLessThan(0.05);
    });
    it(`${sheet.name}: 100–0 km/h in ${sheet.hundredTo0} s`, () => {
      const s = timeUntil(sheet.variant, 100 / 3.6, [1, 0, 0, 1, 3, 0, 0, 0], (t) => t[0]! <= 0);
      expect(Math.abs(s - sheet.hundredTo0) / sheet.hundredTo0).toBeLessThan(0.05);
    });
  }
});

/** Run `sim` for `seconds` at `fps`. */
function drive(sim: VehicleSim, seconds: number, fps = 60, each?: () => void) {
  let telem = sim.update(0);
  for (let i = 0; i < seconds * fps; i++) {
    each?.();
    telem = sim.update(1 / fps);
  }
  return telem;
}

describe('VehicleSim', () => {
  it('maps every vehicle to a variant (unknown → sedan)', () => {
    expect(vehicleVariant('sedan')).toBe(0);
    expect(vehicleVariant('convertible')).toBe(1);
    expect(vehicleVariant('limousine')).toBe(2);
    expect(vehicleVariant('science-lab')).toBe(3);
    expect(vehicleVariant(null)).toBe(0);
  });

  it('starts parked at idle', () => {
    const t = new VehicleSim('sedan').update(1 / 60);
    expect(t.gear).toBe('P');
    expect(t.speedKmh).toBe(0);
    expect(t.rpm).toBeGreaterThan(600);
    expect(t.rpm).toBeLessThan(1000);
  });

  it('sustained hops hold a cruising speed; it coasts down once they stop', () => {
    const sim = new VehicleSim('sedan');
    sim.noteGear('D');
    let frame = 0;
    // A 10 m hop every 1.5 s → a ~36 km/h target.
    const cruising = drive(sim, 12, 60, () => {
      if (frame++ % 90 === 0) sim.notePanoHop(10);
    });
    expect(cruising.speedKmh).toBeGreaterThan(30);
    expect(cruising.speedKmh).toBeLessThan(40);
    expect(['1', '2', '3', 'D']).toContain(cruising.gear);
    expect(cruising.rpm).toBeGreaterThan(1000);
    const stopped = drive(sim, 15);
    expect(stopped.speedKmh).toBeLessThan(0.5);
    expect(stopped.gear).toBe('P');
  });

  it('the engine loads up before the speed moves', () => {
    const sim = new VehicleSim('sedan');
    sim.noteGear('D');
    sim.noteThrust('forward');
    const t = drive(sim, 0.15);
    expect(t.load).toBeGreaterThan(0.4);
    expect(t.speedKmh).toBeLessThan(5);
  });

  it('parks when the cabin gear is P', () => {
    const sim = new VehicleSim('sedan');
    sim.noteThrust('forward');
    drive(sim, 3);
    sim.noteGear('P');
    const parked = drive(sim, 3);
    expect(parked.gear).toBe('P');
    expect(parked.speedKmh).toBeLessThan(1);
  });

  it('S from rest reverses', () => {
    const sim = new VehicleSim('sedan');
    sim.noteThrust('backward');
    const t = drive(sim, 2);
    expect(t.gear).toBe('R');
    expect(t.speedMps).toBeLessThan(-0.5);
  });

  it('integrates the same car at any display rate (fixed step)', () => {
    // Under the coast delay the inputs are constant, so only the step count
    // can differ: exactly the same at 30 and 60 Hz, at most a step behind at 144.
    const run = (fps: number) => {
      const sim = new VehicleSim('sedan');
      sim.noteThrust('forward');
      return drive(sim, 2, fps);
    };
    const a = run(30);
    const b = run(60);
    const c = run(144);
    expect(b.speedKmh).toBe(a.speedKmh);
    expect(b.rpm).toBe(a.rpm);
    expect(Math.abs(c.speedKmh - a.speedKmh)).toBeLessThan(0.1);
  });

  it('a long stall does not fast-forward the car', () => {
    const sim = new VehicleSim('sedan');
    sim.noteThrust('forward');
    sim.update(0);
    const t = sim.update(30);
    expect(t.speedKmh).toBeLessThan(10); // at most 0.25 s integrated
  });

  it('a right turn rolls the body left (heading + clockwise, roll + right side down)', () => {
    const sim = new VehicleSim('limousine');
    sim.noteGear('D');
    let heading = 0;
    let frame = 0;
    const t = drive(sim, 6, 60, () => {
      if (frame++ % 60 === 0) sim.notePanoHop(15);
      if (frame > 180) heading += 0.5; // 30 deg/s to the right
      sim.noteHeading(heading, 1 / 60);
    });
    expect(t.latAccelMps2).toBeLessThan(0);
    expect(t.rollRad).toBeLessThan(0);
  });

  it('switching vehicles keeps the speed', () => {
    const sim = new VehicleSim('sedan');
    let frame = 0;
    const before = drive(sim, 8, 60, () => {
      if (frame++ % 60 === 0) sim.notePanoHop(12);
    });
    sim.setVehicle('limousine');
    const after = sim.update(1 / 60);
    expect(after.speedKmh).toBeCloseTo(before.speedKmh, 0);
    expect(after.redlineRpm).toBe(6000);
  });
});
