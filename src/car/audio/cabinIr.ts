/**
 * Cabin impulse responses.
 *
 * The taps come from the C++ SSOT (`sw_fill_cabin_ir` in
 * `cpp/src/audio_module.cpp`, exported as `fill_cabin_ir`), so the shipping
 * `.wasm`, the host C++ and the pure-JS fallback are pinned to one set of
 * golden vectors — see `docs/WASM_BRIDGE.md`. Nothing here invents DSP; this
 * module only decides which cabin profile a vehicle gets and hands the result
 * to the worklet.
 */

import type { VehicleType } from '../VehicleManager';
import type { StreetViewWasmAPI } from '../../wasm';

/**
 * Taps per cabin IR, per vehicle. The worklet's WASM engine runs a
 * uniformly-partitioned FIR (128-tap partitions), so every length here is a
 * whole number of partitions and costs partitions x 128 x 128 MACs per channel
 * per render quantum — 1024 taps is ~6 % of a 48 kHz quantum on the scalar
 * binary, ~2 % on SIMD (scripts/bench-cabin-dsp.mjs). 1024 taps is 21 ms at
 * 48 kHz: the early reflections plus most of a car's late tail; the
 * limousine's long cabin and the boxy lab get the longest.
 */
export const CABIN_IR_TAPS: Record<VehicleType, number> = {
  sedan: 1024,
  convertible: 1024,
  'science-lab': 1536,
  limousine: 2048,
  cortianics: 1024,
};

/** IR length for a vehicle, defaulting to the sedan's. */
export function cabinIrTaps(vehicle: VehicleType | null | undefined): number {
  return (vehicle && CABIN_IR_TAPS[vehicle]) || CABIN_IR_TAPS.sedan;
}

/**
 * Vehicle → cabin profile index. Declared as a full `Record` on purpose: a new
 * `VehicleType` is a type error here rather than a silent fall back to the
 * sedan room. The order matches `cabin_profiles` in `cpp/src/audio_module.cpp`
 * and `kVehicleVoices` in `cpp/src/cabin_dsp_module.cpp`.
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
  /** Defaults to {@link cabinIrTaps} for the vehicle. */
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
  { vehicle, openness, sampleRate, taps = cabinIrTaps(vehicle) }: CabinIrRequest,
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
