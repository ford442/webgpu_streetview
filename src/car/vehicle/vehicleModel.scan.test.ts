/**
 * The vehicle model has one implementation: cpp/src/vehicle_module.cpp (the
 * WASM rule — no JS twin). The TS side owns the accumulator, the blocks and
 * the hop-derived target speed (vehicleSim.ts); it never integrates speed,
 * runs a gearbox or a torque curve. Same shape as `xr/frameClock.scan.test.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..', '..');
const SIM = path.join(SRC, 'car', 'vehicle', 'vehicleSim.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = walk(SRC);
const rel = (f: string) => path.relative(SRC, f);

describe('the vehicle model lives only in WASM', () => {
  it('VehicleDynamics.ts is gone', () => {
    expect(files.filter((f) => /VehicleDynamics/.test(path.basename(f))).map(rel)).toEqual([]);
  });

  it.each([
    // The retired TS model's tables and rates.
    'SHIFT_POINTS', 'ACCEL_KMH_PER_S', 'BRAKE_KMH_PER_S', 'IDLE_RPM', 'VehicleDynamics',
  ])('no source defines or names %s', (name) => {
    const offenders = files.filter((f) => new RegExp(`\\b${name}\\b`).test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('only vehicleSim.ts steps the model', () => {
    const callers = files.filter((f) => /\.vehicleStep\(|\bveh_step\(/.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(callers.map(rel).sort()).toEqual([rel(SIM), 'wasm/abi.generated.ts', 'wasm/index.ts'].sort());
  });
});
