import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyGltfInterior, isGltfInteriorEnabled } from '../gltfInteriorKit';
import { GLTF_INTERIOR_SOCKETS } from '../gltfSockets';

describe('glTF interior kit flag', () => {
  it('is off by default (procedural interiors, no main-chunk assets)', () => {
    expect(isGltfInteriorEnabled()).toBe(false);
  });

  it('applyGltfInterior returns false on a null host without throwing', async () => {
    const ok = await applyGltfInterior(
      { GLTFLoader: class { loadAsync() { return Promise.resolve({ scene: new THREE.Group() }); } } },
      null,
    );
    expect(ok).toBe(false);
  });

  it('keeps the procedural cabin when required sockets are missing', async () => {
    const host = {
      interiorGroup: new THREE.Group(),
      vehicleType: 'sedan' as const,
      steeringWheelGroup: new THREE.Group(),
      wiperLeft: new THREE.Group(),
      wiperRight: new THREE.Group(),
      speedometerNeedle: new THREE.Mesh(),
      tachometerNeedle: new THREE.Mesh(),
      windshieldGlassMesh: new THREE.Mesh(),
      proceduralCabinGroup: new THREE.Group(),
    };
    host.interiorGroup.add(host.proceduralCabinGroup);
    const ok = await applyGltfInterior(
      { GLTFLoader: class { loadAsync() { return Promise.resolve({ scene: new THREE.Group() }); } } },
      host,
    );
    expect(ok).toBe(false);
    expect(host.proceduralCabinGroup.visible).toBe(true);
  });

  it('exports the socket contract used by the hero sedan GLB', () => {
    expect(GLTF_INTERIOR_SOCKETS).toContain('SteeringWheel');
    expect(GLTF_INTERIOR_SOCKETS).toContain('Windshield');
    expect(GLTF_INTERIOR_SOCKETS).toContain('SideMirrorL');
  });
});
