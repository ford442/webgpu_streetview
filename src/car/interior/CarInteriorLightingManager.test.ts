import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarInteriorLightingManager } from './CarInteriorLightingManager';
import { cabinEmitterTargets, cabinFillTargets } from './cabinLightingRamps';

function makeRig(clinical = false) {
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  const dome = new THREE.PointLight(0xffe8b0, 0);
  const headlights = new THREE.SpotLight(0xffffcc, 0);
  const dash = new THREE.PointLight(0xffe6c2, 0);
  const cluster = new THREE.MeshStandardMaterial();
  const manager = new CarInteriorLightingManager(
    headlights, dome, null, null, null, cluster, null,
    undefined, undefined, undefined, undefined, undefined, undefined,
    null, null, sun, dash, clinical,
  );
  manager.setReducedMotion(true);
  const settle = (night: number, domeOn = false) => {
    for (let frame = 0; frame < 240; frame++) {
      manager.setInteriorLighting(true, night, domeOn);
    }
  };
  return { manager, sun, dome, headlights, dash, cluster, settle };
}

describe('CarInteriorLightingManager night-preset sun', () => {
  it.each([false, true])('lets cabin emitters lead at night even with the real sun up (clinical=%s)', (clinical) => {
    const rig = makeRig(clinical);
    rig.manager.setSunState(0.6, 0.6);
    rig.settle(0);
    expect(rig.sun.intensity).toBeCloseTo(1.55, 4);
    const position = rig.sun.position.clone();
    const color = rig.sun.color.clone();

    const dayIntensity = rig.sun.intensity;
    rig.manager.setInteriorLighting(true, 1, false);
    expect(rig.sun.intensity).toBeGreaterThan(0);
    expect(rig.sun.intensity).toBeLessThan(dayIntensity);
    rig.settle(1);
    expect(rig.manager.getSunNightFactor()).toBe(0);
    expect(rig.manager.getEffectiveNight()).toBe(1);
    expect(rig.sun.intensity).toBeLessThan(0.00001);
    expect(rig.sun.position).toEqual(position);
    expect(rig.sun.color).toEqual(color);

    const input = { effectiveNight: 1, rain: 0, headlightsOn: true, domeLightOn: false, clinical };
    const fill = cabinFillTargets(input);
    expect(rig.dome.intensity).toBe(0);
    expect(rig.headlights.intensity).toBeCloseTo(fill.headlights, 4);
    expect(rig.dash.intensity).toBeCloseTo(fill.dash, 4);
    expect(rig.cluster.emissiveIntensity).toBeCloseTo(cabinEmitterTargets(input).cluster, 4);

    rig.settle(1, true);
    expect(rig.dome.intensity).toBeCloseTo(cabinFillTargets({ ...input, domeLightOn: true }).dome, 4);
    expect(rig.sun.intensity).toBeLessThan(0.00001);

    rig.settle(0);
    expect(rig.sun.intensity).toBeCloseTo(1.55, 4);
  });

  it('preserves overcast attenuation through preset changes and sun refreshes', () => {
    const rig = makeRig();
    rig.manager.setWeatherIntensity(1);
    rig.manager.setSunState(0.6, 0.6);
    rig.settle(0);
    expect(rig.sun.intensity).toBeCloseTo(1.55 * 0.25, 4);
    rig.settle(0.5);
    expect(rig.sun.intensity).toBeCloseTo(1.55 * 0.25 * 0.5, 4);
    rig.settle(1);

    rig.manager.setSunState(-0.4, 0.8);
    rig.settle(1);
    expect(rig.sun.intensity).toBeLessThan(0.00001);
    rig.settle(0);
    expect(rig.sun.intensity).toBeCloseTo(1.55 * 0.25, 4);
  });

  it('does not invent direct sunlight when the real sun is below the horizon', () => {
    const rig = makeRig();
    rig.manager.setSunState(0.6, -0.4);
    rig.settle(0);
    expect(rig.manager.getEffectiveNight()).toBe(1);
    expect(rig.sun.intensity).toBe(0);
    rig.settle(1);
    expect(rig.sun.intensity).toBe(0);
  });
});
