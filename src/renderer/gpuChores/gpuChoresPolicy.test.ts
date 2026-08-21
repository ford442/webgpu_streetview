import { describe, expect, it } from 'vitest';
import {
  readNoGpuComputeFlag,
  resolveCpuChoresBackend,
  resolveGpuChoresEligibility,
} from './gpuChoresPolicy';

describe('gpuChoresPolicy', () => {
  it('treats ?no_gpu_compute as a chores kill switch (bare flag or =1)', () => {
    expect(readNoGpuComputeFlag('')).toBe(false);
    expect(readNoGpuComputeFlag('?weather=compute')).toBe(false);
    expect(readNoGpuComputeFlag('?no_gpu_compute')).toBe(true);
    expect(readNoGpuComputeFlag('?no_gpu_compute=1')).toBe(true);
    expect(readNoGpuComputeFlag('?no_gpu_compute=true')).toBe(true);
    expect(readNoGpuComputeFlag('?no_gpu_compute=0')).toBe(false);
  });

  it('GPU chores require a successful boot probe and no kill switch', () => {
    expect(resolveGpuChoresEligibility('?no_gpu_compute=1', true).gpuEligible).toBe(false);
    expect(resolveGpuChoresEligibility('', false).gpuEligible).toBe(false);
    expect(resolveGpuChoresEligibility('', true).gpuEligible).toBe(true);
  });

  it('CPU fallback prefers WASM when the module compiled', () => {
    expect(resolveCpuChoresBackend(true)).toBe('wasm');
    expect(resolveCpuChoresBackend(false)).toBe('js');
  });
});
