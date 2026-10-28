/**
 * The cabin engine's parameter seqlock: one 64-byte `SharedArrayBuffer` the
 * main thread writes every frame and the AudioWorklet reads at the top of
 * every render quantum — no message, no allocation, no structured clone on
 * either side.
 *
 * Only when the page is `crossOriginIsolated` (dev and prod both send COOP
 * `same-origin` + COEP `credentialless`); otherwise `CabinAudio` posts
 * `{ type: 'params' }` messages as before.
 *
 * Layout (`Int32Array` / `Float32Array` over the same 64 bytes):
 *   [0]      sequence: odd while the writer is mid-update, even when settled
 *   [1..10]  CABIN_RING_FIELDS, as f32 (what `dsp_set_params` takes anyway;
 *            `vehicle` and `wipers` are small integers, exact in f32)
 *   [11..15] reserved
 *
 * The writer bumps the sequence to odd, stores the fields, bumps it to even.
 * The reader (cabinWorkletSource.ts, `pollRing`) loads the sequence, skips if
 * it is odd or already applied, copies the fields, and keeps them only if the
 * sequence is unchanged — a torn read is retried next quantum (2.7 ms), which
 * at a 60 Hz writer never loses a frame's targets for more than one quantum.
 */
import type { CabinDspParams } from '../../wasm';

export const CABIN_RING_BYTES = 64;

/** Field order in slots 1..N, matching `dsp_set_params` after `state`. */
export const CABIN_RING_FIELDS = [
  'rpm', 'load', 'speedMps', 'openness', 'vehicle',
  'wetRoad', 'rain', 'windMps', 'radioGain', 'wipers',
] as const satisfies readonly (keyof CabinDspParams)[];

export interface CabinParamRing {
  readonly buffer: SharedArrayBuffer;
  write(params: CabinDspParams): void;
}

/** True where a `SharedArrayBuffer` can be posted to the worklet. */
export function cabinParamRingSupported(): boolean {
  return typeof SharedArrayBuffer === 'function'
    && typeof Atomics === 'object'
    && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

export function createCabinParamRing(): CabinParamRing {
  const buffer = new SharedArrayBuffer(CABIN_RING_BYTES);
  const seq = new Int32Array(buffer);
  const f32 = new Float32Array(buffer);
  return {
    buffer,
    write(params) {
      Atomics.add(seq, 0, 1);
      for (let i = 0; i < CABIN_RING_FIELDS.length; i++) {
        const v = params[CABIN_RING_FIELDS[i]!];
        f32[i + 1] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
      }
      Atomics.add(seq, 0, 1);
    },
  };
}
