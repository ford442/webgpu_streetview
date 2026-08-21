#!/usr/bin/env node
/**
 * Author a compact sedan-cabin glTF (no Draco / meshopt) with the socket
 * names CarInteriorAnimator / gauges / weather overlay expect.
 *
 * Output: public/models/sedan-cabin.glb — loaded only when ?gltfInterior=1
 * (or the user toggle), so the JS bundle budget is unchanged when the flag
 * is off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'models', 'sedan-cabin.glb');

/** Unit cube: 24 unique verts (per-face normals) + 36 indices. */
function unitCube() {
  const faces = [
    { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
    { n: [1, 0, 0], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  ];
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  let vi = 0;
  for (const f of faces) {
    for (const p of f.v) {
      pos.push(...p);
      nrm.push(...f.n);
    }
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  }
  return {
    pos: new Float32Array(pos),
    nrm: new Float32Array(nrm),
    uv: new Float32Array(uv),
    idx: new Uint16Array(idx),
  };
}

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

function concat(buffers) {
  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of buffers) {
    out.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), o);
    o += b.byteLength;
  }
  return out;
}

const cube = unitCube();
const binParts = [cube.pos, cube.nrm, cube.uv, cube.idx];
let offset = 0;
const views = binParts.map((arr) => {
  const view = { byteOffset: offset, byteLength: arr.byteLength, target: arr === cube.idx ? 34963 : 34962 };
  offset += arr.byteLength;
  const pad = pad4(arr.byteLength);
  offset += pad;
  return { view, pad };
});

const binPadded = [];
binParts.forEach((arr, i) => {
  binPadded.push(arr);
  if (views[i].pad) binPadded.push(new Uint8Array(views[i].pad));
});
const bin = concat(binPadded);

const accessors = [
  { bufferView: 0, componentType: 5126, count: cube.pos.length / 3, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
  { bufferView: 1, componentType: 5126, count: cube.nrm.length / 3, type: 'VEC3' },
  { bufferView: 2, componentType: 5126, count: cube.uv.length / 2, type: 'VEC2' },
  { bufferView: 3, componentType: 5123, count: cube.idx.length, type: 'SCALAR' },
];

const materials = [
  { name: 'leather', pbrMetallicRoughness: { baseColorFactor: [0.22, 0.12, 0.09, 1], metallicFactor: 0, roughnessFactor: 0.72 } },
  { name: 'dash', pbrMetallicRoughness: { baseColorFactor: [0.08, 0.09, 0.10, 1], metallicFactor: 0.15, roughnessFactor: 0.55 } },
  { name: 'chrome', pbrMetallicRoughness: { baseColorFactor: [0.72, 0.74, 0.76, 1], metallicFactor: 0.95, roughnessFactor: 0.18 } },
  { name: 'glass', pbrMetallicRoughness: { baseColorFactor: [0.72, 0.84, 0.92, 0.18], metallicFactor: 0.05, roughnessFactor: 0.06 }, alphaMode: 'BLEND', doubleSided: true },
  { name: 'needle', pbrMetallicRoughness: { baseColorFactor: [0.92, 0.18, 0.12, 1], metallicFactor: 0.3, roughnessFactor: 0.35 } },
  { name: 'unavailableGlass', pbrMetallicRoughness: { baseColorFactor: [0.06, 0.07, 0.09, 1], metallicFactor: 0.4, roughnessFactor: 0.25 } },
];

const meshes = materials.map((_, i) => ({
  primitives: [{
    attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
    indices: 3,
    material: i,
  }],
}));

function node(name, extras) {
  return { name, ...extras };
}

const nodes = [
  node('CabinRoot', { children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] }),
  // Visual cabin (procedural LOD1 stays underneath if this fails to load).
  node('Dash', { mesh: 1, translation: [0, 0.78, -0.98], scale: [1.85, 0.22, 0.55] }),
  node('DashTop', { mesh: 1, translation: [0, 1.02, -0.86], scale: [1.7, 0.06, 0.38] }),
  node('SeatL', { mesh: 0, translation: [-0.35, 0.55, 0.22], scale: [0.42, 0.18, 0.48] }),
  node('SeatLBack', { mesh: 0, translation: [-0.35, 0.95, 0.48], scale: [0.42, 0.7, 0.1] }),
  node('SeatR', { mesh: 0, translation: [0.45, 0.55, 0.22], scale: [0.42, 0.18, 0.48] }),
  node('SeatRBack', { mesh: 0, translation: [0.45, 0.95, 0.48], scale: [0.42, 0.7, 0.1] }),
  node('Floor', { mesh: 1, translation: [0, 0.32, 0.05], scale: [1.9, 0.04, 1.7] }),
  node('ClusterBezel', { mesh: 1, translation: [-0.33, 0.70, -0.86], scale: [0.55, 0.22, 0.08] }),
  // Sockets — named exactly as GLTF_INTERIOR_SOCKETS.
  node('SteeringWheel', { mesh: 2, translation: [-0.35, 0.86, -0.52], rotation: [0.54, 0, 0, 0.841], scale: [0.32, 0.32, 0.04] }),
  node('WiperL', { children: [19], translation: [-0.2, 1.1, -0.9] }),
  node('WiperR', { children: [20], translation: [0.2, 1.1, -0.9] }),
  node('SpeedoNeedle', { mesh: 4, translation: [-0.48, 0.70, -0.83], scale: [0.008, 0.066, 0.004] }),
  node('TachoNeedle', { mesh: 4, translation: [-0.18, 0.70, -0.83], scale: [0.008, 0.066, 0.004] }),
  node('RearviewGlass', { mesh: 5, translation: [0, 1.42, -0.83], scale: [0.28, 0.1, 0.01] }),
  node('SideMirrorL', { mesh: 5, translation: [-0.98, 1.05, -0.52], rotation: [0, 0.24, 0, 0.97], scale: [0.15, 0.2, 0.01] }),
  node('SideMirrorR', { mesh: 5, translation: [0.98, 1.05, -0.52], rotation: [0, -0.24, 0, 0.97], scale: [0.15, 0.2, 0.01] }),
  node('Windshield', { mesh: 3, translation: [0, 1.35, -1.15], rotation: [-0.15, 0, 0, 0.99], scale: [1.7, 0.85, 0.02] }),
  node('APillarL', { mesh: 1, translation: [-0.92, 1.2, -0.85], scale: [0.06, 0.7, 0.08] }),
  // Wiper blades (children of WiperL/R so animator rotation.z sweeps them).
  node('WiperLBlade', { mesh: 2, translation: [0, 0.15, 0], rotation: [0, 0, -0.26, 0.966], scale: [0.02, 0.3, 0.02] }),
  node('WiperRBlade', { mesh: 2, translation: [0, 0.15, 0], rotation: [0, 0, 0.26, 0.966], scale: [0.02, 0.3, 0.02] }),
];

const json = {
  asset: { version: '2.0', generator: 'scripts/gen-hero-cabin-gltf.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes,
  meshes,
  materials,
  accessors,
  bufferViews: views.map((v) => v.view),
  buffers: [{ byteLength: bin.byteLength }],
};

const jsonText = JSON.stringify(json);
const jsonPad = pad4(jsonText.length);
const jsonBuf = Buffer.concat([Buffer.from(jsonText), Buffer.alloc(jsonPad, 0x20)]);
const binPad = pad4(bin.byteLength);
const binBuf = Buffer.concat([Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength), Buffer.alloc(binPad)]);

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);

function chunk(type, data) {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, chunk(JSON_CHUNK, jsonBuf), chunk(BIN_CHUNK, binBuf)]));
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`);
