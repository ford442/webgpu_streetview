import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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

// ── Committed hero sedan GLB (public/models/sedan-cabin.glb) ────────────────
const GLB_PATH = path.resolve(__dirname, '../../../public/models/sedan-cabin.glb');

interface GltfJson {
  nodes: Array<{ name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; material?: number }> }>;
  materials: Array<{ name?: string; extensions?: Record<string, unknown> }>;
  accessors: Array<{ count: number; min?: number[]; max?: number[] }>;
  extensionsUsed?: string[];
  scenes: Array<{ nodes: number[] }>;
}

function readGlb(): { buffer: ArrayBuffer; json: GltfJson } {
  const bytes = fs.readFileSync(GLB_PATH);
  // Copy into this realm's ArrayBuffer: GLTFLoader.parse type-checks with
  // `instanceof ArrayBuffer`, which a Node Buffer fails under jsdom.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8')) as GltfJson;
  return { buffer, json };
}

function parseGlb(buffer: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

function makeHost() {
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
    leftMirrorPlane: undefined as THREE.Mesh | undefined,
    rightMirrorPlane: undefined as THREE.Mesh | undefined,
    rearGlassMesh: undefined as THREE.Mesh | undefined,
    gltfInteriorApplied: false,
  };
  host.interiorGroup.add(host.proceduralCabinGroup);
  return host;
}

describe('hero sedan GLB asset', () => {
  it('is a plain GLB 2.0 with every socket in gltfSockets.ts', () => {
    const bytes = fs.readFileSync(GLB_PATH);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    const { json } = readGlb();
    const names = json.nodes.map((n) => n.name);
    for (const socket of GLTF_INTERIOR_SOCKETS) {
      expect(names).toContain(socket);
    }
  });

  it('is an authored cabin, not the retired unit-cube kit', () => {
    const { json } = readGlb();
    const bytes = fs.statSync(GLB_PATH).size;
    // The cube kit was ~4.8 KB with one shared 24-vert cube.
    expect(bytes).toBeGreaterThan(100 * 1024);
    // Budget for an opt-in, uncompressed asset (see public/models/README.md).
    expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
    const positionAccessors = new Set(
      json.meshes.flatMap((m) => m.primitives.map((p) => p.attributes.POSITION as number)),
    );
    const verts = [...positionAccessors].reduce((s, i) => s + json.accessors[i]!.count, 0);
    expect(verts).toBeGreaterThan(5000);
    // No node reuses a unit mesh via non-uniform scale.
    for (const n of json.nodes) expect(n.scale).toBeUndefined();
    // Recognisable cabin parts beyond the sockets.
    const names = json.nodes.map((n) => n.name);
    for (const part of ['Dash', 'SeatDriver', 'SeatPassenger', 'DoorL', 'DoorR', 'Console', 'Greenhouse']) {
      expect(names).toContain(part);
    }
  });

  it('needs no decoder and never enables glass transmission (#273)', () => {
    const { json } = readGlb();
    expect(json.extensionsUsed ?? []).toEqual([]);
    for (const m of json.materials) expect(m.extensions?.KHR_materials_transmission).toBeUndefined();
  });

  it('keeps Windshield directly under an identity CabinRoot for the weather overlay', () => {
    const { json } = readGlb();
    const rootIdx = json.scenes[0]!.nodes[0]!;
    const root = json.nodes[rootIdx]!;
    expect(root.translation).toBeUndefined();
    expect(root.rotation).toBeUndefined();
    const wsIdx = json.nodes.findIndex((n) => n.name === 'Windshield');
    expect(root.children).toContain(wsIdx);
  });

  it('binds real socket types through applyGltfInterior', async () => {
    const { buffer } = readGlb();
    const scene = await parseGlb(buffer);
    const host = makeHost();
    const rebind = vi.fn();
    const ok = await applyGltfInterior(
      { GLTFLoader: class { loadAsync() { return Promise.resolve({ scene }); } } },
      { ...host, animator: { rebindSockets: rebind } } as unknown as Parameters<typeof applyGltfInterior>[1],
    );
    expect(ok).toBe(true);
    expect(rebind).toHaveBeenCalledTimes(1);
    const bound = rebind.mock.calls[0]![0];

    // Wheel / wipers load as Groups carrying their own tilt, so the animator's
    // rotation.z spins them about their own axes (not the cabin Z axis).
    for (const g of [bound.steeringWheelGroup, bound.wiperLeft, bound.wiperRight]) {
      expect(g).toBeInstanceOf(THREE.Group);
      expect(Math.abs(g.rotation.x)).toBeGreaterThan(0.2);
      expect(g.rotation.z).toBeCloseTo(0, 5);
    }
    const wheel = bound.steeringWheelGroup as THREE.Group;
    const tilt = wheel.rotation.x;
    wheel.rotation.z = 0.7;
    expect(wheel.rotation.x).toBeCloseTo(tilt, 6);

    for (const needle of [bound.speedometerNeedle, bound.tachometerNeedle]) {
      expect(needle).toBeInstanceOf(THREE.Mesh);
      // Pivot at the dial centre: geometry reaches +Y (needle length) from origin.
      const geo = (needle as THREE.Mesh).geometry;
      geo.computeBoundingBox();
      expect(geo.boundingBox!.max.y).toBeGreaterThan(0.05);
      expect(geo.boundingBox!.min.y).toBeLessThan(0);
    }
  });

  it('exposes UV glass for windshield + mirrors with no forward-pano texture', async () => {
    const { buffer } = readGlb();
    const scene = await parseGlb(buffer);
    for (const name of ['Windshield', 'RearviewGlass', 'SideMirrorL', 'SideMirrorR']) {
      const mesh = scene.getObjectByName(name);
      expect(mesh).toBeInstanceOf(THREE.Mesh);
      const m = mesh as THREE.Mesh;
      expect(m.geometry.getAttribute('uv')).toBeDefined();
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(mat.map).toBeNull();
    }
    const ws = scene.getObjectByName('Windshield') as THREE.Mesh;
    const wsMat = ws.material as THREE.MeshStandardMaterial;
    expect(wsMat.transparent).toBe(true);
    expect(wsMat.opacity).toBeLessThan(0.5);
  });
});
