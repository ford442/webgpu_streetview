import {
  alignParticleAxis,
  isParticlePrecipitationEnabled,
  particleCountForGrid,
  particleGridForQuality,
  PARTICLE_FALL_Y_SIGN,
  PARTICLE_WIND_SCALE,
  PARTICLE_FALL_SPEED,
} from './weatherParticles';
import { WEATHER_FALL_Y_SIGN } from '../car/carSpatialModel';

describe('particle precipitation policy', () => {
  it('stays off on the fragment path even at ultra', () => {
    expect(isParticlePrecipitationEnabled({
      weatherMode: 'fragment',
      quality: 'ultra',
      preference: true,
      reducedMotion: false,
    })).toBe(false);
  });

  it('stays off on low and medium even with compute weather', () => {
    for (const quality of ['low', 'medium'] as const) {
      expect(isParticlePrecipitationEnabled({
        weatherMode: 'compute',
        quality,
        preference: true,
        reducedMotion: false,
      })).toBe(false);
    }
  });

  it('enables for high+compute and ultra+compute', () => {
    expect(isParticlePrecipitationEnabled({
      weatherMode: 'compute',
      quality: 'high',
      preference: true,
      reducedMotion: false,
    })).toBe(true);
    expect(isParticlePrecipitationEnabled({
      weatherMode: 'compute',
      quality: 'ultra',
      preference: true,
      reducedMotion: false,
    })).toBe(true);
  });

  it('honours the wasmParticles preference kill switch', () => {
    expect(isParticlePrecipitationEnabled({
      weatherMode: 'compute',
      quality: 'ultra',
      preference: false,
      reducedMotion: false,
    })).toBe(false);
  });

  it('uses a workgroup-aligned square grid and halves it under reduced motion', () => {
    const ultra = particleGridForQuality('ultra', false);
    expect(ultra.width).toBe(ultra.height);
    expect(ultra.width % 16).toBe(0);
    expect(ultra.width).toBeLessThanOrEqual(64);

    const reduced = particleGridForQuality('ultra', true);
    expect(reduced.width).toBeLessThan(ultra.width);
    expect(particleCountForGrid(reduced)).toBeLessThan(particleCountForGrid(ultra));
  });

  it('aligns axes to the 16-wide integrate workgroup', () => {
    expect(alignParticleAxis(1)).toBe(16);
    expect(alignParticleAxis(16)).toBe(16);
    expect(alignParticleAxis(17)).toBe(32);
  });

  it('keeps fall sign and wind/gravity constants locked to carSpatialModel', () => {
    expect(PARTICLE_FALL_Y_SIGN).toBe(WEATHER_FALL_Y_SIGN);
    expect(PARTICLE_FALL_Y_SIGN).toBe(-1);
    expect(PARTICLE_WIND_SCALE).toBeGreaterThan(0);
    expect(PARTICLE_FALL_SPEED).toBeGreaterThan(0);
  });
});
