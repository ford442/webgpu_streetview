/**
 * Cabin impulse responses.
 *
 * The taps come from the C++ SSOT (`sw_fill_cabin_ir` in
 * `cpp/src/noise_module.cpp`, exported as `fill_cabin_ir`), so the shipping
 * `.wasm`, the host C++ and the pure-JS fallback are pinned to one set of
 * golden vectors — see `docs/WASM_BRIDGE.md`. Nothing here invents DSP; this
 * module only decides which cabin profile a vehicle gets and hands the result
 * to the worklet.
 */

import type { VehicleType } from '../VehicleManager';
import type { StreetViewWasmAPI } from '../../wasm';

/**
 * Taps per IR — ~2.9 ms at 44.1 kHz, which covers the direct path and the
 * early reflections of every profile. It is also the FIR length the worklet
 * runs per sample, so it is deliberately short: 128 taps is ~6 M MACs/s at
 * 48 kHz, comfortably inside an audio render quantum.
 */
export const CABIN_IR_TAPS = 128;

/**
 * Vehicle → cabin profile index. Declared as a full `Record` on purpose: a new
 * `VehicleType` is a type error here rather than a silent fall back to the
 * sedan room. The order matches `cabin_profiles` in `cpp/src/noise_module.cpp`.
 */
export const CABIN_IR_VEHICLE_INDEX: Record<VehicleType, number> = {
  sedan: 0,
  convertible: 1,
  'science-lab': 2,
  limousine: 3,
  cortianics: 4,
};

/** Profile index for a vehicle, defaulting to the sedan cabin. */
export function cabinIrVehicleIndex(vehicle: VehicleType | null | undefined): number {
  if (!vehicle) return CABIN_IR_VEHICLE_INDEX.sedan;
  return CABIN_IR_VEHICLE_INDEX[vehicle] ?? CABIN_IR_VEHICLE_INDEX.sedan;
}

export interface CabinIrRequest {
  vehicle: VehicleType | null | undefined;
  /** 0 = sealed, 1 = roof/windows fully open. */
  openness: number;
  sampleRate: number;
  taps?: number;
}

/**
 * Build the cabin IR for a vehicle at a given roof openness.
 *
 * `wasm` is whatever `loadWasmModule()` resolved to — the compiled binary or
 * its JS twin. Both produce the same taps, so the caller never branches on
 * `isWasm`.
 */
export function buildCabinIr(
  wasm: StreetViewWasmAPI,
  { vehicle, openness, sampleRate, taps = CABIN_IR_TAPS }: CabinIrRequest,
): Float32Array {
  const ir = new Float32Array(taps);
  wasm.fillCabinIr(
    ir,
    taps,
    cabinIrVehicleIndex(vehicle),
    Math.max(0, Math.min(1, openness)),
    sampleRate,
  );
  return ir;
}
