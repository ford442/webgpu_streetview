import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const kitMocks = vi.hoisted(() => ({
  isGltfInteriorEnabled: vi.fn(() => true),
  loadGltfInteriorKit: vi.fn(async () => null),
  applyGltfInterior: vi.fn(async () => false),
}));

vi.mock('../gltfInteriorKit', () => kitMocks);

vi.mock('../../effects/WindAudio', () => ({
  getWindAudio: () => ({
    isPlaying: () => false,
    init: async () => false,
    start: async () => {},
    stop: () => {},
    update: () => {},
  }),
}));

import { applyHeroCabinIfEnabled, type CarInteriorAssemblyHost } from '../interior/CarInteriorAssembly';
import { CarInteriorAnimator } from '../interior/CarInteriorAnimator';
import { needleAngle, type GaugeRig } from '../interior/CarInteriorGauges';

afterEach(() => {
  kitMocks.loadGltfInteriorKit.mockClear();
});

describe('hero cabin quality gate', () => {
  it('Low quality never fetches the hero GLB even with the flag on', async () => {
    await applyHeroCabinIfEnabled({ quality: 'low' } as unknown as CarInteriorAssemblyHost);
    expect(kitMocks.loadGltfInteriorKit).not.toHaveBeenCalled();
  });

  it('Medium / High with the flag on load the kit', async () => {
    await applyHeroCabinIfEnabled({ quality: 'high' } as unknown as CarInteriorAssemblyHost);
    expect(kitMocks.loadGltfInteriorKit).toHaveBeenCalledTimes(1);
  });
});

describe('hero cabin gauge needles', () => {
  it('mirror the procedural gauge rig pose onto rebound socket needles', () => {
    const lodManager = { updateLOD: vi.fn() } as unknown as ConstructorParameters<typeof CarInteriorAnimator>[8];
    const animator = new CarInteriorAnimator(
      new THREE.PerspectiveCamera(),
      new THREE.Group(),
      new THREE.Group(),
      new THREE.Group(),
      new THREE.Group(),
      new THREE.Group(),
      null,
      null,
      lodManager,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'high',
      true,
    );
    const rig: GaugeRig = {
      speedNeedle: new THREE.Mesh(),
      tachoNeedle: new THREE.Mesh(),
      fuelNeedle: null,
      tempNeedle: null,
      dialMaterials: [],
      needleMaterials: [],
    };
    animator.setGaugeRig(rig);
    const speedo = new THREE.Mesh();
    const tacho = new THREE.Mesh();
    animator.rebindSockets({ speedometerNeedle: speedo, tachometerNeedle: tacho });

    animator.setGaugeValues(120, 4000);
    animator.update(0.016, 120);

    expect(rig.speedNeedle.rotation.z).not.toBeCloseTo(needleAngle(0), 3);
    expect(speedo.rotation.z).toBeCloseTo(rig.speedNeedle.rotation.z, 6);
    expect(tacho.rotation.z).toBeCloseTo(rig.tachoNeedle.rotation.z, 6);
  });
});
