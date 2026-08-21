/**
 * #216 gpu-chores backend policy.
 *
 * WebGPU → WASM → JS. Chores adopt the renderer GPUDevice (never requestDevice).
 * `?no_gpu_compute` kills GPU chores only — weather fragment/compute is unchanged,
 * so rain still draws without chores.
 */

import { isWebGpuProbeOk } from '../webgpuBootProbe';

export type GpuChoresBackend = 'webgpu' | 'wasm' | 'js';

export function readNoGpuComputeFlag(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const raw = params.get('no_gpu_compute');
    if (raw === null) return params.has('no_gpu_compute');
    const v = raw.toLowerCase();
    if (v === '0' || v === 'false' || v === 'off') return false;
    return true;
  } catch {
    return false;
  }
}

export interface GpuChoresEligibility {
  killSwitch: boolean;
  probeOk: boolean;
  /** True when a shared Renderer device may be used for chores compute. */
  gpuEligible: boolean;
}

export function resolveGpuChoresEligibility(
  search?: string,
  probeOk: boolean = isWebGpuProbeOk(),
): GpuChoresEligibility {
  const killSwitch = readNoGpuComputeFlag(search);
  return {
    killSwitch,
    probeOk,
    gpuEligible: !killSwitch && probeOk,
  };
}

/**
 * Pick the CPU fallback when GPU is ineligible or failed.
 * WASM if the module actually compiled; otherwise the JS twin.
 */
export function resolveCpuChoresBackend(wasmReady: boolean): Exclude<GpuChoresBackend, 'webgpu'> {
  return wasmReady ? 'wasm' : 'js';
}
