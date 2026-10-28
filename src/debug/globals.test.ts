// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installSvGlobals, readWindowProperty } from './globals';
import { noteUnhandled, resetUnhandledErrorsForTests } from '../app/unhandledRejection';
import { publishCabinRendererProbe } from '../car/interior/cabinRendererProbe';
import type { WebGpuProbeRecord } from '../renderer/webgpuBootProbe';

afterEach(() => {
  delete window.__SV__;
  delete window.webgpuProbe;
  delete window.__CABIN_RENDERER_PROBE__;
  resetUnhandledErrorsForTests();
});

describe('window.__SV__', () => {
  it('reads through to the legacy names, live', () => {
    installSvGlobals();
    const sv = window.__SV__;
    expect(sv?.probe).toBeUndefined();
    const probe = { ok: true, stage: 'ready' } as unknown as WebGpuProbeRecord;
    window.webgpuProbe = probe;
    expect(sv?.probe).toBe(probe);
  });

  it('exposes one cabin probe shape, from either publisher slot', () => {
    installSvGlobals();
    window.webgpuProbe = { ok: true } as unknown as WebGpuProbeRecord;
    const cabin = { backend: 'webgpu', preference: 'webgpu', ready: true, updatedAt: 1 } as const;
    publishCabinRendererProbe(cabin);
    expect(window.__SV__?.cabin).toBe(cabin);
    expect(window.webgpuProbe?.cabin).toBe(cabin);
    delete window.__CABIN_RENDERER_PROBE__;
    expect(window.__SV__?.cabin).toBe(cabin);
  });

  it('counts unhandled errors and frame-source stats', () => {
    installSvGlobals();
    noteUnhandled('rejection', new Error('boom'));
    expect(window.__SV__?.errors).toEqual({ rejections: 1, errors: 0, last: 'Error: boom' });
    expect(window.__SV__?.frameSource).toEqual(expect.objectContaining({ samples: expect.any(Number) }));
    expect(window.__SV__?.perf.fps).toEqual(expect.any(Number));
  });

  it('is idempotent and not enumerable', () => {
    installSvGlobals();
    const first = window.__SV__;
    installSvGlobals();
    expect(window.__SV__).toBe(first);
    expect(Object.keys(window)).not.toContain('__SV__');
  });

  it('reports debug mode from ?debug only', () => {
    installSvGlobals();
    expect(window.__SV__?.debug).toBe(false);
  });

  it('readWindowProperty reads a runtime-named global', () => {
    (globalThis as Record<string, unknown>).SomeSdk = 1;
    expect(readWindowProperty('SomeSdk')).toBe(1);
    delete (globalThis as Record<string, unknown>).SomeSdk;
  });
});

describe('window casts', () => {
  it('appear only in debug/globals.ts (the grep the acceptance criteria run)', async () => {
    const { execFileSync } = await import('node:child_process');
    let out = '';
    try {
      out = execFileSync('grep', ['-rln', ['window', 'as'].join(' '), 'src'], { encoding: 'utf8' });
    } catch {
      out = '';
    }
    const files = out.split('\n').filter(Boolean).filter((f) => !f.endsWith('debug/globals.ts'));
    expect(files).toEqual([]);
  });
});
