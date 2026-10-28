// @vitest-environment jsdom
import { requireWasm } from '../wasm';
import { PARTICLE_SEED } from './weatherParticles';
import { ParticleSeedFeeder, fillParticleSeeds, getParticleSeedPreference } from './weatherParticleSeeds';

const setSearch = (search: string) => {
  window.history.pushState({}, '', `/${search}`);
};

beforeEach(() => {
  setSearch('');
  localStorage.clear();
});

describe('getParticleSeedPreference', () => {
  test('defaults to enabled with no params or storage', () => {
    expect(getParticleSeedPreference()).toBe(true);
  });

  test('?wasmParticles=off disables it', () => {
    setSearch('?wasmParticles=off');
    expect(getParticleSeedPreference()).toBe(false);
  });

  test('?wasmParticles=on re-enables it over a stored "off" preference', () => {
    localStorage.setItem('streetview.wasmParticles', 'off');
    setSearch('?wasmParticles=on');
    expect(getParticleSeedPreference()).toBe(true);
  });

  test('a stored "off" preference disables it with no query param', () => {
    localStorage.setItem('streetview.wasmParticles', 'off');
    expect(getParticleSeedPreference()).toBe(false);
  });

  test('?wasmNoise=off does not kill particles', () => {
    setSearch('?wasmNoise=off');
    expect(getParticleSeedPreference()).toBe(true);
  });
});

describe('fillParticleSeeds', () => {
  test.each([0, 1, 777, PARTICLE_SEED, 0xffffffff, -5])('matches the WASM fill_particle_seeds bit for bit (seed %i)', (seed) => {
    const count = 64 * 64;
    const got = new Float32Array(count * 4);
    fillParticleSeeds(got, count, seed);
    const want = new Float32Array(count * 4);
    requireWasm().fillParticleSeeds(want, count, seed);
    expect(new Uint32Array(got.buffer)).toEqual(new Uint32Array(want.buffer));
  });

  test('writes nothing past a short output buffer', () => {
    const out = new Float32Array(6).fill(-1);
    fillParticleSeeds(out, 4, 1);
    expect(out[3]).not.toBe(-1);
    expect(Array.from(out.subarray(4))).toEqual([-1, -1]);
  });
});

describe('ParticleSeedFeeder', () => {
  test('writes 4 floats per particle in the documented ranges, with no load step', () => {
    const count = 8;
    const seeds = new ParticleSeedFeeder().sampleSeeds(count, true, PARTICLE_SEED);
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

  test('returns null for a non-positive count', () => {
    expect(new ParticleSeedFeeder().sampleSeeds(0, true, PARTICLE_SEED)).toBeNull();
  });

  test('reuses the same buffer when count is unchanged', () => {
    const feeder = new ParticleSeedFeeder();
    const first = feeder.sampleSeeds(4, true, PARTICLE_SEED);
    const second = feeder.sampleSeeds(4, true, PARTICLE_SEED);
    expect(second).toBeNull();
    const third = feeder.sampleSeeds(8, true, PARTICLE_SEED);
    expect(third).not.toBeNull();
    expect(third!.length).toBe(32);
    expect(first).not.toBe(third);
  });

  test('reseeds when precipitation restarts after a dry spell', () => {
    const feeder = new ParticleSeedFeeder();
    expect(feeder.sampleSeeds(4, true, PARTICLE_SEED)).not.toBeNull();
    expect(feeder.sampleSeeds(4, false, PARTICLE_SEED)).toBeNull();
    expect(feeder.sampleSeeds(4, true, PARTICLE_SEED)).not.toBeNull();
  });
});
