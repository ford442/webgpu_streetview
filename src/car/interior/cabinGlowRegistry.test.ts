import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  ACCENT_TRIM_GLOW_BASE,
  accentGlowBase,
  beginCabinGlowRegistry,
  registerGlowMaterial,
  resetGlowRegistry,
  setCabinGlowState,
} from './MaterialFactory';
import { getVehicleConfig } from '../VehicleManager';

/**
 * The glow registry is what keeps accent trim (bezels, buttons, the Cortianics
 * ambient strip) on the same night/day curve as the rest of the rig. These are
 * the pure parts: registration, reset on rebuild, and the ramp itself.
 */
describe('cabin glow registry', () => {
  beforeEach(() => resetGlowRegistry());

  const trim = (base = 0.45) => {
    const mat = new THREE.MeshStandardMaterial({
      emissive: 0xdc201c,
      emissiveIntensity: 0,
    });
    registerGlowMaterial(mat, base);
    return mat;
  };

  it('fades registered trim to a hint by day and lifts it at night', () => {
    const mat = trim();

    setCabinGlowState(0, false, 0);
    const day = mat.emissiveIntensity;

    setCabinGlowState(1, false, 0);
    const night = mat.emissiveIntensity;

    expect(day).toBeCloseTo(0.45 * 0.07, 5);
    expect(night).toBeCloseTo(0.45 * 1.12, 5);
    expect(night).toBeGreaterThan(day * 10);
  });

  it('scales every registered material from its own base', () => {
    const strip = trim(0.45);
    const button = trim(0.12);

    setCabinGlowState(1, false, 0);

    expect(strip.emissiveIntensity).toBeGreaterThan(button.emissiveIntensity);
    expect(strip.emissiveIntensity / button.emissiveIntensity).toBeCloseTo(0.45 / 0.12, 5);
  });

  it('bumps trim when the headlights are on at night, not by day', () => {
    const mat = trim();

    setCabinGlowState(0, false, 0);
    const dayOff = mat.emissiveIntensity;
    setCabinGlowState(0, true, 0);
    expect(mat.emissiveIntensity).toBeCloseTo(dayOff, 5);

    setCabinGlowState(1, false, 0);
    const nightOff = mat.emissiveIntensity;
    setCabinGlowState(1, true, 0);
    expect(mat.emissiveIntensity).toBeGreaterThan(nightOff);
  });

  it('drops materials from the previous cabin on rebuild', () => {
    const stale = trim();
    setCabinGlowState(1, false, 0);
    const lit = stale.emissiveIntensity;
    expect(lit).toBeGreaterThan(0);

    resetGlowRegistry();
    setCabinGlowState(0, false, 0);

    // Untouched by the new cabin's state — the old material is no longer driven.
    expect(stale.emissiveIntensity).toBeCloseTo(lit, 5);
  });

  // The shared `materials.accent` (shifter knob, wiper-stalk tip) is created
  // before the interior is built, so the rebuild reset must put it back or it
  // sits at a fixed brightness while every other accent piece ramps.
  describe('beginCabinGlowRegistry', () => {
    const sedan = getVehicleConfig('sedan');
    const accent = () =>
      new THREE.MeshStandardMaterial({ emissive: 0x4caf50, emissiveIntensity: 0.2 });

    it('keeps the shared accent trim on the cabin night/day curve', () => {
      const shared = accent();
      beginCabinGlowRegistry(sedan, { accent: shared });

      setCabinGlowState(0, false, 0);
      expect(shared.emissiveIntensity).toBeCloseTo(ACCENT_TRIM_GLOW_BASE * 0.07, 5);
      setCabinGlowState(1, false, 0);
      expect(shared.emissiveIntensity).toBeCloseTo(ACCENT_TRIM_GLOW_BASE * 1.12, 5);
    });

    it('drops the previous cabin while re-registering the shared accent', () => {
      const stale = trim();
      setCabinGlowState(1, false, 0);
      const lit = stale.emissiveIntensity;

      const shared = accent();
      beginCabinGlowRegistry(sedan, { accent: shared });
      setCabinGlowState(0, false, 0);

      expect(stale.emissiveIntensity).toBeCloseTo(lit, 5);
      expect(shared.emissiveIntensity).toBeCloseTo(ACCENT_TRIM_GLOW_BASE * 0.07, 5);
    });

    it('tolerates a cabin with no shared accent', () => {
      beginCabinGlowRegistry(sedan, {});
      expect(() => setCabinGlowState(1, true, 0)).not.toThrow();
    });

    it('applies the neon theme boost through accentGlowBase', () => {
      expect(accentGlowBase(sedan, 0.2)).toBeCloseTo(0.2, 6);
      expect(accentGlowBase({ ...sedan, theme: 'neon' }, 0.2)).toBeCloseTo(0.32, 6);
    });
  });
});
