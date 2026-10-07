/**
 * #216 gpu-chores backend policy.
 *
 * WebGPU → WASM → JS. Chores adopt the renderer GPUDevice (never requestDevice).
 * `?no_gpu_compute` kills GPU chores only — weather fragment/compute is unchanged,
 * so rain still draws without chores.
 */

import { currentSearch, readFlag } from '../../config/flags';
import { isWebGpuProbeOk, type WebGpuProbeRecord } from '../webgpuBootProbe';

export type GpuChoresBackend = 'webgpu' | 'wasm' | 'js';

export function readNoGpuComputeFlag(search: string = currentSearch()): boolean {
  return readFlag('no_gpu_compute', search);
}

export interface GpuChoresLimitsVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Adapter-limit verdict the boot published on the capability matrix
 * (`gpuChoresGpuEligible`). A matrix without the field reads as ok — the
 * pipeline-create catch in `GpuChores.init` is the second line of defense.
 */
export function readGpuChoresLimitsVerdict(
  win: { webgpuProbe?: WebGpuProbeRecord } | undefined = typeof window !== 'undefined' ? window : undefined,
): GpuChoresLimitsVerdict {
  const matrix = win?.webgpuProbe?.capabilityMatrix;
  if (matrix?.gpuChoresGpuEligible === false) {
    return { ok: false, reason: matrix.gpuChoresIneligibleReason };
  }
  return { ok: true };
}

export interface GpuChoresEligibility {
  killSwitch: boolean;
  probeOk: boolean;
  /** Adapter limits can run the 8×8 chores pipelines. */
  limitsOk: boolean;
  limitsReason?: string;
  /** True when a shared Renderer device may be used for chores compute. */
  gpuEligible: boolean;
}

export function resolveGpuChoresEligibility(
  search?: string,
  probeOk: boolean = isWebGpuProbeOk(),
  limits: GpuChoresLimitsVerdict = readGpuChoresLimitsVerdict(),
): GpuChoresEligibility {
  const killSwitch = readNoGpuComputeFlag(search);
  return {
    killSwitch,
    probeOk,
    limitsOk: limits.ok,
    limitsReason: limits.reason,
    gpuEligible: !killSwitch && probeOk && limits.ok,
  };
}

/**
 * Pick the CPU fallback when GPU is ineligible or failed.
 * WASM if the module actually compiled; otherwise the JS twin.
 */
export function resolveCpuChoresBackend(wasmReady: boolean): Exclude<GpuChoresBackend, 'webgpu'> {
  return wasmReady ? 'wasm' : 'js';
}
