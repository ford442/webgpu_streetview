/**
 * The cabin IR as the audio layer consumes it.
 *
 * The numbers themselves are pinned by the golden vectors
 * (cpp/tests/goldens.json → C++ ctest + src/wasm/__tests__/wasmGoldenParity);
 * what this file covers is the part that lives in TypeScript: the vehicle →
 * profile mapping, and the audible contract the cabin depends on — an open
 * roof passes more high frequency than a sealed one, at the same level.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { VEHICLE_LIST, type VehicleType } from '../VehicleManager';
import { loadWasmModule, type StreetViewWasmAPI } from '../../wasm';
import {
  buildCabinIr,
  cabinIrTaps,
  cabinIrVehicleIndex,
  CABIN_IR_TAPS,
  CABIN_IR_VEHICLE_INDEX,
} from './cabinIr';

/**
 * Top-octave transfer: the magnitude of the IR's Nyquist response over its DC
 * response. Small = muffled cabin, large = open air. Mirrors `hf_transfer` in
 * cpp/tests/noise_module_test.cpp.
 */
function hfTransfer(ir: Float32Array): number {
  let dc = 0;
  let nyquist = 0;
  for (let i = 0; i < ir.length; i++) {
    dc += ir[i]!;
    nyquist += i % 2 === 0 ? ir[i]! : -ir[i]!;
  }
  return Math.abs(nyquist) / Math.abs(dc);
}

/**
 * Broadband brightness: energy of the IR's first difference over its energy.
 * A single Nyquist bin random-walks over a long noisy tail, so the full-length
 * IRs are compared with this instead (0 = DC only, 4 = all at Nyquist).
 */
function brightness(ir: Float32Array): number {
  let e = 0;
  let d = 0;
  for (let i = 0; i < ir.length; i++) {
    e += ir[i]! * ir[i]!;
    const diff = ir[i]! - (i > 0 ? ir[i - 1]! : 0);
    d += diff * diff;
  }
  return d / e;
}

function dcGain(ir: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < ir.length; i++) sum += ir[i]!;
  return sum;
}

let wasm: StreetViewWasmAPI;

beforeAll(async () => {
  // No fetch for public/wasm/ in this environment, so this is the JS twin —
  // which the golden tests hold bit-identical to the shipping binary.
  wasm = await loadWasmModule();
});

describe('cabinIrVehicleIndex', () => {
  it('maps every vehicle in the SSOT to a distinct profile', () => {
    const indices = VEHICLE_LIST.map((config) => cabinIrVehicleIndex(config.type));
    expect(new Set(indices).size).toBe(VEHICLE_LIST.length);
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(Object.keys(CABIN_IR_VEHICLE_INDEX).length);
    }
  });

  it('falls back to the sedan cabin for a missing vehicle', () => {
    expect(cabinIrVehicleIndex(null)).toBe(CABIN_IR_VEHICLE_INDEX.sedan);
    expect(cabinIrVehicleIndex(undefined)).toBe(CABIN_IR_VEHICLE_INDEX.sedan);
  });
});

describe('buildCabinIr', () => {
  const build = (vehicle: VehicleType, openness: number): Float32Array =>
    buildCabinIr(wasm, { vehicle, openness, sampleRate: 44100 });

  it('returns the vehicle\'s tap count, starting with the direct path', () => {
    for (const config of VEHICLE_LIST) {
      const ir = build(config.type, 0);
      expect(ir.length).toBe(CABIN_IR_TAPS[config.type]);
      expect(ir[0]).toBeGreaterThan(0);
    }
    expect(cabinIrTaps(null)).toBe(CABIN_IR_TAPS.sedan);
  });

  it('gives every vehicle at least 1024 taps in whole 128-tap partitions, the limousine the most', () => {
    const taps = VEHICLE_LIST.map((config) => CABIN_IR_TAPS[config.type]);
    for (const n of taps) {
      expect(n).toBeGreaterThanOrEqual(1024);
      expect(n % 128).toBe(0);
      expect(n).toBeLessThanOrEqual(4096); // dsp_max_ir_taps
    }
    expect(CABIN_IR_TAPS.limousine).toBe(Math.max(...taps));
  });

  it('a long IR carries a late tail, more with the roof up', () => {
    // From tap 512 (11.6 ms at 44.1 kHz) the early tail has died away.
    const late = (ir: Float32Array): number => {
      let e = 0;
      for (let i = 512; i < ir.length; i++) e += ir[i]! * ir[i]!;
      return e;
    };
    for (const config of VEHICLE_LIST) {
      expect(late(build(config.type, 0))).toBeGreaterThan(late(build(config.type, 1)));
    }
    expect(late(build('limousine', 0))).toBeGreaterThan(late(build('sedan', 0)));
  });

  it('roof open is brighter than roof closed, at the same level', () => {
    for (const config of VEHICLE_LIST) {
      const closed = build(config.type, 0);
      const open = build(config.type, 1);
      // Audibly brighter: at least double the top-octave transfer of the
      // first partition (direct path + early reflections) ...
      expect(hfTransfer(open.subarray(0, 128))).toBeGreaterThan(hfTransfer(closed.subarray(0, 128)) * 2);
      // ... and brighter over the whole IR, late tail included.
      expect(brightness(open)).toBeGreaterThan(brightness(closed) * 1.5);
      // ... without the roof toggle jumping the cabin's loudness.
      expect(dcGain(open)).toBeCloseTo(1, 4);
      expect(dcGain(closed)).toBeCloseTo(1, 4);
    }
  });

  it('tracks openness monotonically between the two extremes', () => {
    const transfer = [0, 0.25, 0.5, 0.75, 1].map((openness) =>
      brightness(build('convertible', openness)),
    );
    for (let i = 1; i < transfer.length; i++) {
      expect(transfer[i]!).toBeGreaterThan(transfer[i - 1]!);
    }
  });

  it('gives each vehicle its own room', () => {
    const sedan = Array.from(build('sedan', 0));
    for (const config of VEHICLE_LIST) {
      if (config.type === 'sedan') continue;
      expect(Array.from(build(config.type, 0))).not.toEqual(sedan);
    }
  });

  it('clamps openness instead of producing a wilder room', () => {
    expect(Array.from(build('sedan', 4))).toEqual(Array.from(build('sedan', 1)));
    expect(Array.from(build('sedan', -4))).toEqual(Array.from(build('sedan', 0)));
  });
});
