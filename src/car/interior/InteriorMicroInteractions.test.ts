import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { InteriorMicroInteractions, InteriorInteractive } from './InteriorMicroInteractions';

const RECT = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
const CENTER_X = 50;
const CENTER_Y = 50;

const DETENTS = [0.2, 0.1, 0, -0.1];

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('InteriorMicroInteractions levers', () => {
  let micro: InteriorMicroInteractions;
  let mesh: THREE.Mesh;
  let camera: THREE.PerspectiveCamera;
  let root: THREE.Group;
  let detents: number[];
  let lever: InteriorInteractive;

  beforeEach(() => {
    micro = new InteriorMicroInteractions();
    mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.name = 'testLever';
    root = new THREE.Group();
    root.add(mesh);
    camera = makeCamera();
    detents = [];
    lever = {
      mesh,
      kind: 'lever',
      axis: 'x',
      detents: DETENTS,
      onDetent: (index) => detents.push(index),
    };
    micro.register([lever]);
  });

  const tap = () => {
    micro.handlePointerDown(CENTER_X, CENTER_Y, RECT, camera, root, true);
    micro.handlePointerUp();
  };

  it('rests at the first detent after registration', () => {
    expect(micro.getLeverIndexByName('testLever')).toBe(0);
    expect(mesh.rotation.x).toBeCloseTo(DETENTS[0]!);
  });

  it('honours an initial detent', () => {
    micro.register([{ ...lever, initialDetent: 2 }]);
    expect(micro.getLeverIndexByName('testLever')).toBe(2);
    expect(mesh.rotation.x).toBeCloseTo(DETENTS[2]!);
  });

  it('cycles one detent per tap and wraps at the end', () => {
    for (let i = 0; i < DETENTS.length; i++) tap();
    expect(detents).toEqual([1, 2, 3, 0]);
    expect(micro.getLeverIndexByName('testLever')).toBe(0);
  });

  it('ignores taps when interior edit mode is off', () => {
    micro.handlePointerDown(CENTER_X, CENTER_Y, RECT, camera, root, false);
    micro.handlePointerUp();
    expect(detents).toEqual([]);
    expect(micro.getLeverIndexByName('testLever')).toBe(0);
  });

  it('drags through detents without wrapping past the last one', () => {
    micro.handlePointerDown(CENTER_X, CENTER_Y, RECT, camera, root, true);
    micro.handlePointerMove(CENTER_X, CENTER_Y + 60); // ~2 detents at 26px each
    expect(micro.getLeverIndexByName('testLever')).toBe(2);
    micro.handlePointerMove(CENTER_X, CENTER_Y + 400);
    expect(micro.getLeverIndexByName('testLever')).toBe(DETENTS.length - 1);
    micro.handlePointerUp();
    // A drag must not also fire the tap-to-cycle wrap.
    expect(detents[detents.length - 1]).toBe(DETENTS.length - 1);
  });

  it('drag back toward the start returns to earlier detents', () => {
    micro.setLeverIndexByName('testLever', 3);
    micro.handlePointerDown(CENTER_X, CENTER_Y, RECT, camera, root, true);
    micro.handlePointerMove(CENTER_X, CENTER_Y - 60);
    expect(micro.getLeverIndexByName('testLever')).toBe(1);
    micro.handlePointerUp();
  });

  it('external moves do not re-fire the detent callback', () => {
    micro.setLeverIndexByName('testLever', 2);
    expect(micro.getLeverIndexByName('testLever')).toBe(2);
    expect(detents).toEqual([]);
  });

  it('eases the pivot toward the selected detent', () => {
    const pivot = new THREE.Group();
    mesh.rotation.x = 0;
    pivot.add(mesh);
    root.add(pivot);
    micro.register([{ ...lever, pivot }]);
    micro.setLeverIndexByName('testLever', 3);
    for (let i = 0; i < 60; i++) micro.update(1 / 60);
    expect(pivot.rotation.x).toBeCloseTo(DETENTS[3]!, 3);
    // The grab target itself stays put; the assembly swings.
    expect(mesh.rotation.x).toBe(0);
  });
});
