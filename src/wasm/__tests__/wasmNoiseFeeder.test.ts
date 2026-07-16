import {
  WasmNoiseFeeder,
  NOISE_TILE_SIZE,
  NOISE_UPDATE_INTERVAL_FRAMES,
  getWasmNoisePreference,
} from '../wasmNoiseFeeder';
import { _resetWasmModule } from '../index';

const setSearch = (search: string) => {
  window.history.pushState({}, '', `/${search}`);
};

beforeEach(() => {
  _resetWasmModule();
  setSearch('');
  localStorage.clear();
});

describe('getWasmNoisePreference', () => {
  test('defaults to enabled with no params or storage', () => {
    expect(getWasmNoisePreference()).toBe(true);
  });

  test('?wasmNoise=off disables it', () => {
    setSearch('?wasmNoise=off');
    expect(getWasmNoisePreference()).toBe(false);
  });

  test('?wasmNoise=on re-enables it over a stored "off" preference', () => {
    localStorage.setItem('streetview.wasmNoise', 'off');
    setSearch('?wasmNoise=on');
    expect(getWasmNoisePreference()).toBe(true);
  });

  test('a stored "off" preference disables it with no query param', () => {
    localStorage.setItem('streetview.wasmNoise', 'off');
    expect(getWasmNoisePreference()).toBe(false);
  });
});

describe('WasmNoiseFeeder', () => {
  test('is not ready until the module loads', () => {
    const feeder = new WasmNoiseFeeder();
    expect(feeder.isReady).toBe(false);
  });

  test('sampleTile returns null before the module has finished loading', () => {
    const feeder = new WasmNoiseFeeder();
    // Synchronously right after construction, loadWasmModule() hasn't resolved yet.
    expect(feeder.sampleTile(0, 0)).toBeNull();
  });

  test('sampleTile returns a full tile once loaded, on the update cadence', async () => {
    const feeder = new WasmNoiseFeeder();
    await feeder.waitUntilLoaded();
    expect(feeder.isReady).toBe(true);

    const tile = feeder.sampleTile(0, 1.23);
    expect(tile).not.toBeNull();
    expect(tile!.length).toBe(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
    for (let i = 0; i < tile!.length; i++) {
      expect(tile![i]).toBeGreaterThanOrEqual(-1);
      expect(tile![i]).toBeLessThanOrEqual(1);
    }
  });

  test('sampleTile returns null between cadence boundaries and non-null on them', async () => {
    const feeder = new WasmNoiseFeeder();
    await feeder.waitUntilLoaded();

    expect(feeder.sampleTile(1, 0)).toBeNull();
    expect(feeder.sampleTile(NOISE_UPDATE_INTERVAL_FRAMES - 1, 0)).toBeNull();
    expect(feeder.sampleTile(NOISE_UPDATE_INTERVAL_FRAMES, 0)).not.toBeNull();
    expect(feeder.sampleTile(NOISE_UPDATE_INTERVAL_FRAMES * 2, 0)).not.toBeNull();
  });

  test('reuses the same underlying buffer instance across calls (no per-frame allocation)', async () => {
    const feeder = new WasmNoiseFeeder();
    await feeder.waitUntilLoaded();

    const first = feeder.sampleTile(0, 0);
    const second = feeder.sampleTile(NOISE_UPDATE_INTERVAL_FRAMES, 1);
    expect(first).toBe(second);
  });

  test('isWasm reflects the loaded module (false for the JS fallback used in Jest)', async () => {
    const feeder = new WasmNoiseFeeder();
    await feeder.waitUntilLoaded();
    expect(feeder.isWasm).toBe(false);
  });
});
