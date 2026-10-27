import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = new Map<string, unknown>();

vi.mock('./offlineStore', () => ({
  offlineGetJson: vi.fn(async (store: string) => idb.get(store) ?? null),
  offlineSetJson: vi.fn(async (store: string, value: unknown) => {
    idb.set(store, value);
  }),
}));

import { loadMirroredJson, saveMirroredJson } from './offlinePersistence';

function stubQuotaFullStorage() {
  const removeItem = vi.fn();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    }),
    removeItem,
  });
  return removeItem;
}

describe('offlinePersistence localStorage mirror', () => {
  beforeEach(() => {
    idb.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('saves to IndexedDB and drops the stale mirror when localStorage is full', async () => {
    const removeItem = stubQuotaFullStorage();
    await expect(saveMirroredJson('tours', [{ id: 't' }])).resolves.toBeUndefined();
    expect(idb.get('tours')).toEqual([{ id: 't' }]);
    expect(removeItem).toHaveBeenCalledWith('webgpu_streetview_tours');
  });

  it('still loads from IndexedDB when the mirror write throws', async () => {
    idb.set('tours', [{ id: 'kept' }]);
    stubQuotaFullStorage();
    await expect(loadMirroredJson('tours')).resolves.toEqual([{ id: 'kept' }]);
  });
});
