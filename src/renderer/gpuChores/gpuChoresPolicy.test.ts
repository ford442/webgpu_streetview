import { describe, expect, it } from 'vitest';
import {
  readGpuChoresLimitsVerdict,
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

  it('adapter limits below the chores workgroup skip GPU chores without the kill switch', () => {
    const low = { ok: false, reason: 'Adapter limit maxComputeWorkgroupSizeX=4 below gpu-chores 8' };
    const e = resolveGpuChoresEligibility('', true, low);
    expect(e.gpuEligible).toBe(false);
    expect(e.killSwitch).toBe(false);
    expect(e.limitsOk).toBe(false);
    expect(e.limitsReason).toBe(low.reason);
    expect(resolveGpuChoresEligibility('', true, { ok: true }).gpuEligible).toBe(true);
  });

  it('reads the limits verdict from the published capability matrix', () => {
    expect(readGpuChoresLimitsVerdict(undefined)).toEqual({ ok: true });
    expect(readGpuChoresLimitsVerdict({})).toEqual({ ok: true });
    const probe = (gpuChoresGpuEligible: boolean, gpuChoresIneligibleReason?: string) => ({
      webgpuProbe: { capabilityMatrix: { gpuChoresGpuEligible, gpuChoresIneligibleReason } },
    }) as unknown as Parameters<typeof readGpuChoresLimitsVerdict>[0];
    expect(readGpuChoresLimitsVerdict(probe(true))).toEqual({ ok: true });
    expect(readGpuChoresLimitsVerdict(probe(false, 'low'))).toEqual({ ok: false, reason: 'low' });
  });

  it('CPU fallback prefers WASM when the module compiled', () => {
    expect(resolveCpuChoresBackend(true)).toBe('wasm');
    expect(resolveCpuChoresBackend(false)).toBe('js');
  });
});
