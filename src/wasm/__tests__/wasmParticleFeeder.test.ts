import {
  WasmParticleFeeder,
  getWasmParticlePreference,
} from '../wasmParticleFeeder';
import { _resetWasmModule, loadWasmModule } from '../index';
import { PARTICLE_SEED } from '../../renderer/weatherParticles';

const setSearch = (search: string) => {
  window.history.pushState({}, '', `/${search}`);
};

beforeEach(() => {
  _resetWasmModule();
  setSearch('');
  localStorage.clear();
});

describe('getWasmParticlePreference', () => {
  test('defaults to enabled with no params or storage', () => {
    expect(getWasmParticlePreference()).toBe(true);
  });

  test('?wasmParticles=off disables it', () => {
    setSearch('?wasmParticles=off');
    expect(getWasmParticlePreference()).toBe(false);
  });

  test('?wasmParticles=on re-enables it over a stored "off" preference', () => {
    localStorage.setItem('streetview.wasmParticles', 'off');
    setSearch('?wasmParticles=on');
    expect(getWasmParticlePreference()).toBe(true);
  });

  test('a stored "off" preference disables it with no query param', () => {
    localStorage.setItem('streetview.wasmParticles', 'off');
    expect(getWasmParticlePreference()).toBe(false);
  });

  test('?wasmNoise=off does not kill particles', () => {
    setSearch('?wasmNoise=off');
    expect(getWasmParticlePreference()).toBe(true);
  });
});

describe('WasmParticleFeeder', () => {
  test('is not ready until the module loads', () => {
    const feeder = new WasmParticleFeeder();
    expect(feeder.isReady).toBe(false);
  });

  test('sampleSeeds returns null before the module has finished loading', () => {
    const feeder = new WasmParticleFeeder();
    expect(feeder.sampleSeeds(16, true, PARTICLE_SEED)).toBeNull();
  });

  test('writes 4 floats per particle in the documented ranges', async () => {
    const feeder = new WasmParticleFeeder();
    await feeder.waitUntilLoaded();
    const count = 8;
    const seeds = feeder.sampleSeeds(count, true, PARTICLE_SEED);
    expect(seeds).not.toBeNull();
    expect(seeds!.length).toBe(count * 4);
    for (let i = 0; i < count; i++) {
      const x = seeds![i * 4]!;
      const y = seeds![i * 4 + 1]!;
      const speed = seeds![i * 4 + 2]!;
      const phase = seeds![i * 4 + 3]!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(1);
      expect(speed).toBeGreaterThanOrEqual(0.5);
      expect(speed).toBeLessThan(1.5);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(6.2831855);
    }
  });

  test('matches fillParticleSeeds bit-for-bit (JS fallback path)', async () => {
    const feeder = new WasmParticleFeeder();
    await feeder.waitUntilLoaded();
    const wasm = await loadWasmModule();
    const count = 6;
    const seeds = Float32Array.from(feeder.sampleSeeds(count, true, 777)!);
    const expected = new Float32Array(count * 4);
    wasm.fillParticleSeeds(expected, count, 777);
    expect(Array.from(seeds)).toEqual(Array.from(expected));
  });

  test('reuses the same buffer when count is unchanged', async () => {
    const feeder = new WasmParticleFeeder();
    await feeder.waitUntilLoaded();
    const first = feeder.sampleSeeds(4, true, PARTICLE_SEED);
    const second = feeder.sampleSeeds(4, true, PARTICLE_SEED);
    expect(second).toBeNull();
    const third = feeder.sampleSeeds(8, true, PARTICLE_SEED);
    expect(third).not.toBeNull();
    expect(third!.length).toBe(32);
    expect(first).not.toBe(third);
  });

  test('reseeds when precipitation restarts after a dry spell', async () => {
    const feeder = new WasmParticleFeeder();
    await feeder.waitUntilLoaded();
    expect(feeder.sampleSeeds(4, true, PARTICLE_SEED)).not.toBeNull();
    expect(feeder.sampleSeeds(4, false, PARTICLE_SEED)).toBeNull();
    expect(feeder.sampleSeeds(4, true, PARTICLE_SEED)).not.toBeNull();
  });

  test('isWasm is false for the JS fallback used in Node tests', async () => {
    const feeder = new WasmParticleFeeder();
    await feeder.waitUntilLoaded();
    expect(feeder.isWasm).toBe(false);
  });
});
