import { afterEach, describe, expect, it, vi } from 'vitest';

const importState = vi.hoisted(() => ({ fail: true, attempts: 0 }));

function mockRuntime() {
  vi.doMock('./carModeRuntime', () => {
    importState.attempts += 1;
    if (importState.fail) throw new Error('chunk load failed');
    return { marker: 'runtime' };
  });
}

async function freshLoader() {
  vi.resetModules();
  mockRuntime();
  const [loader, errors] = await Promise.all([import('./carRuntimeLoader'), import('../debug/unhandledRejection')]);
  return { ...loader, getUnhandledErrors: errors.getUnhandledErrors };
}

describe('carRuntimeLoader', () => {
  afterEach(() => {
    importState.fail = true;
    importState.attempts = 0;
    vi.restoreAllMocks();
  });

  it('does not cache a rejected import: the next call retries', async () => {
    const { loadCarRuntime } = await freshLoader();
    await expect(loadCarRuntime()).rejects.toThrow();
    importState.fail = false;
    vi.resetModules();
    mockRuntime();
    const retry = await loadCarRuntime();
    expect((retry as unknown as { marker: string }).marker).toBe('runtime');
  });

  it('shares one in-flight import between concurrent callers', async () => {
    importState.fail = false;
    const { loadCarRuntime } = await freshLoader();
    expect(loadCarRuntime()).toBe(loadCarRuntime());
  });

  it('withCarRuntime reports a failed load instead of rejecting', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { withCarRuntime, getUnhandledErrors } = await freshLoader();
    const before = getUnhandledErrors().rejections;
    await expect(withCarRuntime(() => undefined)).resolves.toBeUndefined();
    expect(getUnhandledErrors().rejections).toBe(before + 1);
    expect(getUnhandledErrors().last).toBeTruthy();
  });
});
