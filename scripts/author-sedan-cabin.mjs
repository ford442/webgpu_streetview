#!/usr/bin/env node
/**
 * Parametric authoring source for the hero sedan cabin
 * (`public/models/sedan-cabin.glb`, loaded only with `?gltfInterior=1` or the
 * Ultra toggle — never on Low, never from the main chunk).
 *
 * This replaces the old unit-cube generator. Every panel is sculpted from
 * three.js curve/extrude/lathe/torus primitives in cabin-local metres (the
 * same frame as `vehicleLayout.ts`: +X right, +Y up, -Z forward, driver on the
 * left), creased normals are baked, and the result is written as a plain
 * GLB 2.0 (no Draco / meshopt — see public/models/README.md for the budget).
 *
 * Socket contract (`src/car/gltfSockets.ts`) is validated before writing:
 *  - SteeringWheel / WiperL / WiperR carry ≥2 primitives so GLTFLoader yields
 *    a THREE.Group whose own rotation.z the animator spins (wheel spins about
 *    its column axis, wipers sweep in the glass plane).
 *  - Needles, mirrors and Windshield are single-primitive meshes (THREE.Mesh).
 *  - Windshield sits directly under an identity CabinRoot so
 *    WindowWeatherOverlay can copy its local transform into interiorGroup.
 *  - No KHR_materials_transmission anywhere: the windshield stays a tinted
 *    hole until the compositor samples the HDR intermediate (#273).
 *
 * Output is deterministic: re-running on the same three.js yields the same
 * bytes. Run: `npm run gen:hero-cabin`.
 *
 * License: original work authored for this repository (CC0 1.0 — see
 * public/models/README.md). No manufacturer CAD or scanned data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  mergeGeometries,
  mergeVertices,
  toCreasedNormals,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'models', 'sedan-cabin.glb');
const SOCKETS_TS = path.join(ROOT, 'src', 'car', 'gltfSockets.ts');

const CREASE = THREE.MathUtils.degToRad(38);

// ── Layout anchors (keep in sync with vehicleLayout.ts sedan defaults) ──────
const SPEEDO = new THREE.Vector3(-0.48, 0.70, -0.84);
const TACHO = new THREE.Vector3(-0.18, 0.70, -0.84);
const DIAL_R = 0.085;
const NEEDLE_LEN = 0.066;
const NEEDLE_Z = 0.006;
const WHEEL_POS = new THREE.Vector3(-0.35, 0.86, -0.52);
const WHEEL_RIM_R = 0.17;
/** Wheel plane tilt: top leans toward the windshield like a real column. */
const WHEEL_TILT = -0.42;
const CABIN_HALF_W = 0.93;

// Windshield: raked glass from the dash top to the header.
const GLASS_W = 1.84;
const GLASS_H = 0.72;
const GLASS_RAKE = 0.588; // rad from vertical, top toward the driver
const GLASS_CENTER = new THREE.Vector3(0, 1.28, -0.9);

// ── Materials ───────────────────────────────────────────────────────────────
const MATERIALS = [
  { name: 'leather', pbrMetallicRoughness: { baseColorFactor: [0.29, 0.155, 0.085, 1], metallicFactor: 0, roughnessFactor: 0.62 } },
  { name: 'dash', pbrMetallicRoughness: { baseColorFactor: [0.07, 0.075, 0.08, 1], metallicFactor: 0, roughnessFactor: 0.72 } },
  { name: 'chrome', pbrMetallicRoughness: { baseColorFactor: [0.75, 0.76, 0.78, 1], metallicFactor: 0.95, roughnessFactor: 0.2 } },
  {
    name: 'glass',
    pbrMetallicRoughness: { baseColorFactor: [0.72, 0.84, 0.92, 0.18], metallicFactor: 0.05, roughnessFactor: 0.06 },
    alphaMode: 'BLEND',
    doubleSided: true,
  },
  {
    name: 'needle',
    pbrMetallicRoughness: { baseColorFactor: [0.95, 0.25, 0.12, 1], metallicFactor: 0.2, roughnessFactor: 0.35 },
    emissiveFactor: [0.9, 0.2, 0.08],
  },
  { name: 'unavailableGlass', pbrMetallicRoughness: { baseColorFactor: [0.06, 0.07, 0.09, 1], metallicFactor: 0.4, roughnessFactor: 0.25 } },
  { name: 'trim', pbrMetallicRoughness: { baseColorFactor: [0.12, 0.12, 0.13, 1], metallicFactor: 0.05, roughnessFactor: 0.5 } },
  { name: 'headliner', pbrMetallicRoughness: { baseColorFactor: [0.62, 0.6, 0.56, 1], metallicFactor: 0, roughnessFactor: 0.95 } },
  { name: 'carpet', pbrMetallicRoughness: { baseColorFactor: [0.05, 0.05, 0.055, 1], metallicFactor: 0, roughnessFactor: 1 } },
  { name: 'stitch', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.72, 0.6, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
  { name: 'gaugeFace', pbrMetallicRoughness: { baseColorFactor: [0.02, 0.02, 0.025, 1], metallicFactor: 0, roughnessFactor: 0.4 } },
  {
    name: 'gaugeMark',
    pbrMetallicRoughness: { baseColorFactor: [0.85, 0.87, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.5 },
    emissiveFactor: [0.55, 0.6, 0.65],
  },
  {
    name: 'screen',
    pbrMetallicRoughness: { baseColorFactor: [0.01, 0.015, 0.02, 1], metallicFactor: 0.1, roughnessFactor: 0.15 },
    emissiveFactor: [0.02, 0.05, 0.08],
  },
  { name: 'aluminium', pbrMetallicRoughness: { baseColorFactor: [0.55, 0.56, 0.58, 1], metallicFactor: 0.9, roughnessFactor: 0.35 } },
];
const M = Object.fromEntries(MATERIALS.map((m, i) => [m.name, i]));

// ── Geometry helpers ────────────────────────────────────────────────────────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Bake a TRS into geometry (Euler XYZ radians). Returns the same geometry. */
function T(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  _m.compose(new THREE.Vector3(...p), _q, new THREE.Vector3(...s));
  geo.applyMatrix4(_m);
  return geo;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Rounded, bevelled slab w×h (XY) and d thick (Z), centred on the origin. */
function slab(w, h, d, r = 0.02, bevel = 0.008, curveSegments = 3) {
  const b = Math.min(bevel, d / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w - 2 * b, h - 2 * b, Math.max(0, r - b)), {
    depth: d - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  return g;
}

/**
 * Side profile extruded across the cabin: `pts` are [forward, y] pairs
 * (forward = -z), extruded from x0 to x1.
 */
function sideProfile(pts, x0, x1, bevel = 0.006, smooth = false) {
  const s = new THREE.Shape();
  if (smooth) {
    s.moveTo(pts[0][0], pts[0][1]);
    s.splineThru(pts.slice(1).map(([a, b]) => new THREE.Vector2(a, b)));
  } else {
    s.moveTo(pts[0][0], pts[0][1]);
    for (const [a, b] of pts.slice(1)) s.lineTo(a, b);
  }
  s.closePath();
  const depth = x1 - x0 - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
  });
  // shape x (forward) → -z, extrude z → +x
  g.rotateY(Math.PI / 2);
  g.translate(x0 + bevel, 0, 0);
  return g;
}

/** Elliptic rounded beam between two points. */
function beam(a, b, w, d, segments = 10) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(0.5, 0.5, len, segments, 1, false);
  g.scale(w, 1, d);
  const dir = B.clone().sub(A).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  const mid = A.add(B).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

function mirrorX(geo) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  // Flip winding after the mirror so faces still point outward.
  const idx = g.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  } else {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.attributes[name];
      for (let i = 0; i < attr.count; i += 3) {
        for (let c = 0; c < attr.itemSize; c++) {
          const t = attr.getComponent(i + 1, c);
          attr.setComponent(i + 1, c, attr.getComponent(i + 2, c));
          attr.setComponent(i + 2, c, t);
        }
      }
    }
  }
  return g;
}

/** Normalise a part for merging: non-indexed, creased normals, optional UVs. */
function prep(geo, keepUv) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && !(keepUv && name === 'uv')) g.deleteAttribute(name);
  }
  if (keepUv) {
    g.computeVertexNormals();
  } else {
    g = toCreasedNormals(g, CREASE);
  }
  return g;
}

// ── Scene description ───────────────────────────────────────────────────────
/** name → { material → geometry[] } */
const nodes = [];

function node(name, opts = {}) {
  const n = {
    name,
    parts: new Map(),
    keepUv: !!opts.keepUv,
    translation: opts.translation,
    rotation: opts.rotation,
  };
  nodes.push(n);
  return {
    add(material, ...geos) {
      if (!(material in M)) throw new Error(`unknown material ${material}`);
      const list = n.parts.get(material) ?? [];
      list.push(...geos);
      n.parts.set(material, list);
      return this;
    },
  };
}

// Shell: floor + footwells ---------------------------------------------------
node('Floor').add(
  'carpet',
  sideProfile(
    [[-1.3, 0.3], [-1.3, 0.345], [0.78, 0.345], [0.98, 0.42], [1.12, 0.5], [1.16, 0.5], [1.16, 0.3]],
    -CABIN_HALF_W,
    CABIN_HALF_W,
    0.004,
  ),
);

// Dashboard: outboard + passenger sections share one profile; the driver
// section is recessed for the cluster with a hood brow over it.
const DASH_MAIN = [
  [0.72, 0.5], [0.73, 0.66], [0.75, 0.8], [0.77, 0.9], [0.8, 0.96], [0.86, 0.995],
  [0.96, 1.005], [1.08, 0.995], [1.14, 0.975], [1.16, 0.9], [1.16, 0.5],
];
const DASH_CLUSTER = [
  [0.74, 0.5], [0.76, 0.575], [0.87, 0.575], [0.87, 0.835], [0.74, 0.89], [0.755, 0.945],
  [0.8, 0.985], [0.86, 1.012], [0.96, 1.015], [1.08, 0.995], [1.14, 0.975], [1.16, 0.9], [1.16, 0.5],
];
node('Dash').add(
  'dash',
  sideProfile(DASH_MAIN, -CABIN_HALF_W, -0.68),
  sideProfile(DASH_CLUSTER, -0.68, -0.08),
  sideProfile(DASH_MAIN, -0.08, CABIN_HALF_W),
);
// Brushed trim strip across the passenger side + defrost slot.
node('DashTrim')
  .add('aluminium', T(slab(0.62, 0.028, 0.012, 0.006, 0.003), { p: [0.6, 0.8, -0.748], r: [-0.12, 0, 0] }))
  .add('trim', T(box(1.4, 0.006, 0.05), { p: [0, 1.009, -1.0] }));

// Instrument cluster: dial faces, bezels, tick marks, hubs, info display.
{
  const faces = [];
  const bezels = [];
  const ticks = [];
  const hubs = [];
  for (const c of [SPEEDO, TACHO]) {
    faces.push(T(new THREE.CircleGeometry(DIAL_R, 40), { p: [c.x, c.y, c.z] }));
    bezels.push(T(new THREE.TorusGeometry(DIAL_R + 0.006, 0.0045, 6, 40), { p: [c.x, c.y, c.z + 0.004] }));
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      const a = THREE.MathUtils.degToRad(225 - 270 * t);
      const major = i % 2 === 0;
      const len = major ? 0.014 : 0.008;
      const rr = DIAL_R - 0.006 - len / 2;
      ticks.push(
        T(new THREE.PlaneGeometry(major ? 0.0028 : 0.0018, len), {
          p: [c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, c.z + 0.0012],
          r: [0, 0, a - Math.PI / 2],
        }),
      );
    }
    hubs.push(T(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 14), { p: [c.x, c.y, c.z + 0.011], r: [Math.PI / 2, 0, 0] }));
  }
  node('ClusterDials')
    .add('gaugeFace', ...faces, T(slab(0.075, 0.1, 0.004, 0.008, 0.001), { p: [-0.33, 0.7, -0.843] }))
    .add('chrome', ...bezels)
    .add('gaugeMark', ...ticks)
    .add('trim', ...hubs);
}

// Center stack: fascia, screen, vents, HVAC knobs + buttons.
{
  const cx = 0.05;
  const fascia = T(slab(0.34, 0.5, 0.1, 0.03, 0.01), { p: [cx, 0.7, -0.79], r: [-0.1, 0, 0] });
  const screenBezel = T(slab(0.29, 0.18, 0.02, 0.012, 0.004), { p: [cx, 0.86, -0.735], r: [-0.14, 0, 0] });
  const screen = T(new THREE.PlaneGeometry(0.26, 0.15), { p: [cx, 0.86, -0.7245], r: [-0.14, 0, 0] });
  const ventFrames = [];
  const ventSlats = [];
  for (const dx of [-0.075, 0.075]) {
    ventFrames.push(T(slab(0.13, 0.055, 0.012, 0.01, 0.003), { p: [cx + dx, 0.735, -0.735], r: [-0.1, 0, 0] }));
    for (let i = 0; i < 4; i++) {
      ventSlats.push(T(box(0.11, 0.004, 0.02), { p: [cx + dx, 0.72 + i * 0.01, -0.733], r: [-0.25, 0, 0] }));
    }
  }
  const knobs = [];
  for (const dx of [-0.1, 0.1]) {
    knobs.push(T(new THREE.CylinderGeometry(0.022, 0.024, 0.025, 20), { p: [cx + dx, 0.62, -0.74], r: [Math.PI / 2 - 0.1, 0, 0] }));
  }
  const buttons = [];
  for (let i = 0; i < 5; i++) {
    buttons.push(T(slab(0.028, 0.016, 0.008, 0.004, 0.002), { p: [cx - 0.06 + i * 0.03, 0.665, -0.738], r: [-0.1, 0, 0] }));
  }
  node('CenterStack')
    .add('trim', fascia, screenBezel, ...ventSlats, ...buttons)
    .add('screen', screen)
    .add('chrome', ...ventFrames, ...knobs);
}

// Outboard round vents.
{
  const rings = [];
  const cores = [];
  for (const x of [-0.8, 0.8]) {
    rings.push(T(new THREE.TorusGeometry(0.045, 0.007, 8, 28), { p: [x, 0.86, -0.765], r: [-0.25, 0, 0] }));
    cores.push(T(new THREE.CylinderGeometry(0.041, 0.041, 0.012, 24), { p: [x, 0.86, -0.772], r: [Math.PI / 2 - 0.25, 0, 0] }));
    for (let i = -1; i <= 1; i++) {
      cores.push(T(box(0.075, 0.004, 0.016), { p: [x, 0.86 + i * 0.022, -0.762], r: [-0.25, 0, 0] }));
    }
  }
  node('SideVents').add('chrome', ...rings).add('trim', ...cores);
}

// Center console: tunnel, armrest lid, cupholders, shifter.
{
  const tunnel = sideProfile(
    [[-0.3, 0.34], [-0.3, 0.7], [-0.26, 0.73], [0.06, 0.73], [0.1, 0.66], [0.5, 0.6], [0.68, 0.56], [0.74, 0.5], [0.74, 0.34]],
    -0.1,
    0.2,
    0.01,
  );
  const lid = T(slab(0.3, 0.34, 0.035, 0.05, 0.012), { p: [0.05, 0.745, 0.1], r: [-Math.PI / 2, 0, 0] });
  const cups = [];
  for (const dx of [-0.045, 0.045]) {
    cups.push(T(new THREE.TorusGeometry(0.036, 0.005, 6, 24), { p: [0.05 + dx, 0.607, -0.4], r: [-Math.PI / 2 + 0.15, 0, 0] }));
  }
  const bootPts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    bootPts.push(new THREE.Vector2(0.055 * (1 - t) * (1 - t) + 0.012, t * 0.1));
  }
  const boot = T(new THREE.LatheGeometry(bootPts, 18), { p: [0.05, 0.64, -0.24] });
  const stick = T(new THREE.CylinderGeometry(0.008, 0.009, 0.08, 10), { p: [0.05, 0.76, -0.24] });
  const knob = T(new THREE.SphereGeometry(0.028, 18, 12), { p: [0.05, 0.815, -0.24], s: [1, 1.15, 1] });
  node('Console')
    .add('trim', tunnel)
    .add('leather', lid, boot, knob)
    .add('chrome', ...cups, stick);
  // Lid stitching.
  node('ConsoleStitch').add(
    'stitch',
    T(box(0.004, 0.002, 0.3), { p: [-0.08, 0.764, 0.1] }),
    T(box(0.004, 0.002, 0.3), { p: [0.18, 0.764, 0.1] }),
  );
}

// Steering column shroud (the wheel itself is the SteeringWheel socket).
node('SteeringColumn').add('trim', beam([-0.35, 0.82, -0.6], [-0.35, 0.56, -0.8], 0.1, 0.075, 14));

// Seats (driver + passenger): cushion, backrest with bolsters, headrest,
// stitched centre panels.
function seat(x) {
  const leather = [];
  const stitch = [];
  const chrome = [];
  const trim = [];
  const cushion = T(slab(0.5, 0.5, 0.12, 0.08, 0.035, 5), { p: [x, 0.52, 0.2], r: [-Math.PI / 2 - 0.08, 0, 0] });
  const back = T(slab(0.5, 0.64, 0.12, 0.09, 0.035, 5), { p: [x, 0.92, 0.55], r: [0.2, 0, 0] });
  leather.push(cushion, back);
  for (const side of [-1, 1]) {
    leather.push(
      T(slab(0.085, 0.5, 0.1, 0.04, 0.03, 4), { p: [x + side * 0.215, 0.9, 0.485], r: [0.2, 0, side * 0.08] }),
      T(slab(0.085, 0.44, 0.08, 0.035, 0.025, 4), { p: [x + side * 0.215, 0.575, 0.2], r: [-Math.PI / 2 - 0.08, 0, 0] }),
    );
    // Double seam lines on the backrest face and cushion top.
    stitch.push(
      T(box(0.004, 0.52, 0.002), { p: [x + side * 0.12, 0.92, 0.489], r: [0.2, 0, 0] }),
      T(box(0.004, 0.002, 0.42), { p: [x + side * 0.12, 0.585, 0.2], r: [-0.08, 0, 0] }),
    );
  }
  // Horizontal quilt seams on the backrest.
  for (let i = -2; i <= 2; i++) {
    const y = 0.92 + i * 0.1;
    const z = 0.55 - 0.061 / Math.cos(0.2) + (y - 0.92) * Math.tan(0.2);
    stitch.push(T(box(0.2, 0.004, 0.002), { p: [x, y, z - 0.0005], r: [0.2, 0, 0] }));
  }
  const headrest = T(slab(0.27, 0.18, 0.1, 0.06, 0.03, 5), { p: [x, 1.36, 0.65], r: [0.12, 0, 0] });
  leather.push(headrest);
  for (const dx of [-0.07, 0.07]) {
    chrome.push(T(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8), { p: [x + dx, 1.24, 0.63], r: [0.2, 0, 0] }));
  }
  // Seat frame / runners.
  trim.push(T(box(0.42, 0.06, 0.55), { p: [x, 0.39, 0.2] }));
  return { leather, stitch, chrome, trim };
}
for (const [name, x] of [['SeatDriver', -0.35], ['SeatPassenger', 0.45]]) {
  const s = seat(x);
  node(name).add('leather', ...s.leather).add('stitch', ...s.stitch).add('chrome', ...s.chrome).add('trim', ...s.trim);
}

// Rear bench (visible when the driver turns around).
node('RearBench')
  .add(
    'leather',
    T(slab(1.62, 0.48, 0.13, 0.08, 0.04, 4), { p: [0, 0.55, 1.05], r: [-Math.PI / 2 - 0.06, 0, 0] }),
    T(slab(1.62, 0.6, 0.13, 0.08, 0.04, 4), { p: [0, 0.92, 1.33], r: [0.24, 0, 0] }),
  )
  .add('trim', T(box(1.84, 0.03, 0.4), { p: [0, 1.22, 1.62] }));

// Door cards (left authored, right mirrored).
{
  const card = sideProfile(
    [[-0.62, 0.36], [-0.62, 0.99], [-0.5, 1.01], [0.62, 1.02], [0.9, 1.0], [0.98, 0.9], [0.98, 0.36]],
    -0.97,
    -0.9,
    0.008,
  );
  const armrest = T(slab(0.08, 0.62, 0.05, 0.03, 0.015), { p: [-0.87, 0.74, -0.02], r: [-Math.PI / 2, 0, 0] });
  const pocket = sideProfile([[-0.2, 0.42], [-0.2, 0.52], [0.7, 0.52], [0.7, 0.42]], -0.905, -0.86, 0.006);
  const sill = T(box(0.03, 0.012, 1.55), { p: [-0.905, 1.02, 0.0] });
  const handle = T(slab(0.1, 0.028, 0.02, 0.012, 0.004), { p: [-0.893, 0.86, -0.3], r: [0, Math.PI / 2, 0] });
  const speaker = T(new THREE.CircleGeometry(0.07, 28), { p: [-0.897, 0.5, -0.62], r: [0, Math.PI / 2, 0] });
  const speakerRing = T(new THREE.TorusGeometry(0.072, 0.005, 6, 28), { p: [-0.897, 0.5, -0.62], r: [0, Math.PI / 2, 0] });
  const insert = T(slab(0.012, 0.16, 0.9, 0.02, 0.004), { p: [-0.897, 0.9, 0.05] });
  const L = {
    trim: [card, pocket],
    leather: [armrest, insert],
    chrome: [sill, handle, speakerRing],
    gaugeFace: [speaker],
  };
  const dl = node('DoorL');
  const dr = node('DoorR');
  for (const [mat, geos] of Object.entries(L)) {
    dl.add(mat, ...geos);
    dr.add(mat, ...geos.map((g) => mirrorX(g)));
  }
}

// Greenhouse: A/B/C pillars, roof rails, header, headliner, visors.
{
  const glassUp = new THREE.Vector3(0, Math.cos(GLASS_RAKE), Math.sin(GLASS_RAKE));
  const glassBottom = GLASS_CENTER.clone().addScaledVector(glassUp, -GLASS_H / 2);
  const glassTop = GLASS_CENTER.clone().addScaledVector(glassUp, GLASS_H / 2);
  const pillars = [];
  const rails = [];
  for (const side of [-1, 1]) {
    pillars.push(
      beam([side * 0.915, glassBottom.y, glassBottom.z], [side * 0.875, glassTop.y + 0.01, glassTop.z], 0.075, 0.06, 12),
      beam([side * 0.925, 1.0, 0.62], [side * 0.885, 1.6, 0.58], 0.1, 0.07, 12),
      beam([side * 0.9, 1.0, 1.55], [side * 0.8, 1.58, 1.3], 0.16, 0.08, 12),
    );
    rails.push(beam([side * 0.89, glassTop.y + 0.01, glassTop.z], [side * 0.89, 1.605, 1.3], 0.06, 0.05, 10));
  }
  const header = T(slab(1.78, 0.07, 0.05, 0.02, 0.01), { p: [0, glassTop.y + 0.02, glassTop.z + 0.01], r: [GLASS_RAKE, 0, 0] });

  // Headliner: a gently domed panel facing down.
  const linerFront = glassTop.z + 0.02;
  const linerBack = 1.3;
  const liner = new THREE.PlaneGeometry(1.8, linerBack - linerFront, 12, 10);
  liner.rotateX(Math.PI / 2); // normal → -Y
  const lp = liner.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i);
    lp.setY(i, 1.64 - 0.035 * (x / 0.9) * (x / 0.9));
  }
  liner.translate(0, 0, (linerFront + linerBack) / 2);
  const visors = [];
  const visorClips = [];
  for (const x of [-0.42, 0.42]) {
    visors.push(T(slab(0.36, 0.16, 0.022, 0.03, 0.008), { p: [x, 1.585, glassTop.z + 0.1], r: [-Math.PI / 2 + 0.12, 0, 0] }));
    visorClips.push(T(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), { p: [x - 0.18 * Math.sign(x), 1.6, glassTop.z + 0.03] }));
  }
  const dome = T(slab(0.18, 0.1, 0.02, 0.03, 0.006), { p: [0, 1.615, 0.25], r: [Math.PI / 2, 0, 0] });
  node('Greenhouse')
    .add('trim', ...pillars, ...rails, header)
    .add('headliner', liner, ...visors)
    .add('chrome', ...visorClips)
    .add('screen', dome);
}

// Rearview mirror housing + stem (glass is the RearviewGlass socket).
const REARVIEW = { p: [0, 1.44, -0.755], yaw: -0.18 };
node('RearviewHousing').add(
  'trim',
  T(slab(0.27, 0.08, 0.035, 0.03, 0.01), { p: [REARVIEW.p[0], REARVIEW.p[1], REARVIEW.p[2] - 0.012], r: [0, REARVIEW.yaw, 0] }),
  beam([0, 1.52, -0.745], [0, 1.455, -0.765], 0.018, 0.018, 8),
);

// Side mirror housings (glass planes are the SideMirrorL/R sockets).
const SIDE_MIRROR = { p: [-1.0, 1.06, -0.55], yaw: 0.5 };
{
  const housing = T(slab(0.2, 0.15, 0.08, 0.05, 0.02, 4), {
    p: [SIDE_MIRROR.p[0], SIDE_MIRROR.p[1], SIDE_MIRROR.p[2] - 0.045],
    r: [0, SIDE_MIRROR.yaw, 0],
  });
  const arm = beam([-0.93, 1.02, -0.62], [SIDE_MIRROR.p[0] + 0.02, 1.04, SIDE_MIRROR.p[2] - 0.05], 0.03, 0.05, 8);
  node('SideMirrorHousingL').add('dash', housing, arm);
  node('SideMirrorHousingR').add('dash', mirrorX(housing), mirrorX(arm));
}

// ── Sockets ─────────────────────────────────────────────────────────────────
function quatFromEuler(x, y, z) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return [q.x, q.y, q.z, q.w];
}

// SteeringWheel: rim in local XY facing +Z (driver); animator spins rotation.z.
{
  const rim = new THREE.TorusGeometry(WHEEL_RIM_R, 0.017, 12, 56);
  const hub = new THREE.CylinderGeometry(0.062, 0.07, 0.05, 28);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, -0.01, 0.01);
  const pad = T(slab(0.12, 0.09, 0.02, 0.035, 0.008, 4), { p: [0, -0.005, 0.038] });
  const spokes = [];
  for (const [a, w] of [[0, 0.045], [Math.PI, 0.045], [-Math.PI / 2, 0.05]]) {
    const len = WHEEL_RIM_R - 0.06;
    const mid = 0.06 + len / 2 - 0.005;
    spokes.push(T(slab(len, w, 0.014, 0.012, 0.005), { p: [Math.cos(a) * mid, Math.sin(a) * mid, 0.004], r: [0, 0, a] }));
  }
  const badge = T(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 16), { p: [0, -0.005, 0.05], r: [Math.PI / 2, 0, 0] });
  const stitches = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    stitches.push(
      T(box(0.003, 0.012, 0.004), {
        p: [Math.cos(a) * (WHEEL_RIM_R + 0.012), Math.sin(a) * (WHEEL_RIM_R + 0.012), 0.008],
        r: [0, 0, a],
      }),
    );
  }
  nodes.push({
    name: 'SteeringWheel',
    parts: new Map([
      ['leather', [rim]],
      ['trim', [hub, pad, ...spokes]],
      ['chrome', [badge]],
      ['stitch', stitches],
    ]),
    translation: WHEEL_POS.toArray(),
    rotation: quatFromEuler(WHEEL_TILT, 0, 0),
  });
}

// Wipers: pivot below the glass, rotated into the glass plane so rotation.z
// (driven by the animator) sweeps them across the windshield. Park pose is
// z = ∓π/6; the blade direction is baked so park lies along the cowl.
function wiper(name, pivotX, bakedAngle) {
  const R = new THREE.Matrix4().makeRotationX(GLASS_RAKE);
  const local = new THREE.Vector3(pivotX, -GLASS_H / 2 - 0.01, -0.03).applyMatrix4(R);
  const pivot = GLASS_CENTER.clone().add(local);
  const armLen = 0.46;
  const arm = T(box(armLen, 0.012, 0.01), { p: [armLen / 2, 0, 0] });
  const blade = T(box(armLen * 0.95, 0.006, 0.014), { p: [armLen * 0.52, 0.01, 0.004] });
  const cap = T(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 14), { r: [Math.PI / 2, 0, 0] });
  for (const g of [arm, blade]) g.rotateZ(bakedAngle);
  nodes.push({
    name,
    parts: new Map([
      ['trim', [arm, blade]],
      ['chrome', [cap]],
    ]),
    translation: pivot.toArray(),
    rotation: quatFromEuler(GLASS_RAKE, 0, 0),
  });
}
// Left blade points left at park (z = -π/6) and lifts as z goes negative;
// right blade mirrors it.
wiper('WiperL', -0.1, Math.PI + Math.PI / 6);
wiper('WiperR', 0.14, Math.PI / 6);

// Needles: pivot at the dial centre, pointing +Y at rotation.z = 0.
function needleGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.0032, -0.012);
  s.lineTo(0.0032, -0.012);
  s.lineTo(0.0012, NEEDLE_LEN);
  s.lineTo(-0.0012, NEEDLE_LEN);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.0015, bevelEnabled: false });
  return g;
}
for (const [name, c] of [['SpeedoNeedle', SPEEDO], ['TachoNeedle', TACHO]]) {
  nodes.push({
    name,
    parts: new Map([['needle', [needleGeo()]]]),
    translation: [c.x, c.y, c.z + NEEDLE_Z],
  });
}

// Rearview + side mirror glass (need UVs for the rear feed texture).
nodes.push({
  name: 'RearviewGlass',
  parts: new Map([['unavailableGlass', [new THREE.PlaneGeometry(0.245, 0.062)]]]),
  keepUv: true,
  translation: [REARVIEW.p[0], REARVIEW.p[1], REARVIEW.p[2] + 0.0065],
  rotation: quatFromEuler(0, REARVIEW.yaw, 0),
});
{
  const glassGeo = () => new THREE.PlaneGeometry(0.17, 0.12);
  nodes.push({
    name: 'SideMirrorL',
    parts: new Map([['unavailableGlass', [glassGeo()]]]),
    keepUv: true,
    translation: SIDE_MIRROR.p,
    rotation: quatFromEuler(0, SIDE_MIRROR.yaw, 0),
  });
  nodes.push({
    name: 'SideMirrorR',
    parts: new Map([['unavailableGlass', [glassGeo()]]]),
    keepUv: true,
    translation: [-SIDE_MIRROR.p[0], SIDE_MIRROR.p[1], SIDE_MIRROR.p[2]],
    rotation: quatFromEuler(0, -SIDE_MIRROR.yaw, 0),
  });
}

// Windshield: gently curved glass with UVs for WindowWeatherOverlay.
{
  const g = new THREE.PlaneGeometry(GLASS_W, GLASS_H, 16, 8);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (GLASS_W / 2);
    const v = pos.getY(i) / (GLASS_H / 2);
    pos.setZ(i, -0.035 * (1 - u * u) - 0.01 * (1 - v * v));
  }
  nodes.push({
    name: 'Windshield',
    parts: new Map([['glass', [g]]]),
    keepUv: true,
    translation: GLASS_CENTER.toArray(),
    rotation: quatFromEuler(GLASS_RAKE, 0, 0),
  });
}

// ── Build buffers ───────────────────────────────────────────────────────────
function round(v, d = 6) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

const binChunks = [];
let binLength = 0;
const bufferViews = [];
const accessors = [];

function pushView(typed, target) {
  const byteOffset = binLength;
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  binChunks.push(bytes);
  binLength += bytes.byteLength;
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) {
    binChunks.push(new Uint8Array(pad));
    binLength += pad;
  }
  bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target });
  return bufferViews.length - 1;
}

function pushAccessor(typed, type, componentType, target, withBounds) {
  const view = pushView(typed, target);
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
  const acc = { bufferView: view, componentType, count: typed.length / size, type };
  if (withBounds) {
    const min = new Array(size).fill(Infinity);
    const max = new Array(size).fill(-Infinity);
    for (let i = 0; i < typed.length; i += size) {
      for (let c = 0; c < size; c++) {
        min[c] = Math.min(min[c], typed[i + c]);
        max[c] = Math.max(max[c], typed[i + c]);
      }
    }
    acc.min = min;
    acc.max = max;
  }
  accessors.push(acc);
  return accessors.length - 1;
}

const meshes = [];
const gltfNodes = [{ name: 'CabinRoot', children: [] }];
let totalVerts = 0;
let totalTris = 0;

for (const n of nodes) {
  const primitives = [];
  for (const [matName, geos] of n.parts) {
    const merged = mergeGeometries(geos.map((g) => prep(g, n.keepUv)), false);
    if (!merged) throw new Error(`merge failed for ${n.name}/${matName}`);
    const indexed = mergeVertices(merged, 1e-5);
    const posArr = new Float32Array(indexed.attributes.position.array);
    const nrmArr = new Float32Array(indexed.attributes.normal.array);
    const idxSrc = indexed.index.array;
    const vcount = posArr.length / 3;
    const idxArr = vcount < 65536 ? Uint16Array.from(idxSrc) : Uint32Array.from(idxSrc);
    const attributes = {
      POSITION: pushAccessor(posArr, 'VEC3', 5126, 34962, true),
      NORMAL: pushAccessor(nrmArr, 'VEC3', 5126, 34962, false),
    };
    if (n.keepUv && indexed.attributes.uv) {
      attributes.TEXCOORD_0 = pushAccessor(new Float32Array(indexed.attributes.uv.array), 'VEC2', 5126, 34962, false);
    }
    const indices = pushAccessor(idxArr, 'SCALAR', vcount < 65536 ? 5123 : 5125, 34963, false);
    primitives.push({ attributes, indices, material: M[matName] });
    totalVerts += vcount;
    totalTris += idxArr.length / 3;
  }
  meshes.push({ name: n.name, primitives });
  const gn = { name: n.name, mesh: meshes.length - 1 };
  if (n.translation) gn.translation = n.translation.map((v) => round(v));
  if (n.rotation) gn.rotation = n.rotation.map((v) => round(v, 7));
  gltfNodes.push(gn);
  gltfNodes[0].children.push(gltfNodes.length - 1);
}

// ── Validate the socket contract before writing ─────────────────────────────
const socketSrc = fs.readFileSync(SOCKETS_TS, 'utf8');
const socketBlock = socketSrc.match(/GLTF_INTERIOR_SOCKETS\s*=\s*\[([\s\S]*?)\]/);
if (!socketBlock) throw new Error('could not parse GLTF_INTERIOR_SOCKETS');
const sockets = [...socketBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const byName = new Map(gltfNodes.map((n) => [n.name, n]));
const problems = [];
for (const s of sockets) {
  const n = byName.get(s);
  if (!n) {
    problems.push(`missing socket ${s}`);
    continue;
  }
  const prims = meshes[n.mesh].primitives.length;
  const wantsGroup = s === 'SteeringWheel' || s === 'WiperL' || s === 'WiperR';
  if (wantsGroup && prims < 2) problems.push(`${s} must have ≥2 primitives (loads as THREE.Group)`);
  if (!wantsGroup && prims !== 1) problems.push(`${s} must have exactly 1 primitive (loads as THREE.Mesh)`);
}
for (const m of MATERIALS) {
  if (m.extensions?.KHR_materials_transmission) problems.push(`material ${m.name} enables transmission`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

// ── Write GLB ───────────────────────────────────────────────────────────────
const json = {
  asset: {
    version: '2.0',
    generator: 'scripts/author-sedan-cabin.mjs',
    copyright: 'CC0-1.0 — original parametric model, webgpu_streetview contributors',
  },
  scene: 0,
  scenes: [{ name: 'SedanCabin', nodes: [0] }],
  nodes: gltfNodes,
  meshes,
  materials: MATERIALS,
  accessors,
  bufferViews,
  buffers: [{ byteLength: binLength }],
};

const jsonBuf0 = Buffer.from(JSON.stringify(json));
const jsonBuf = Buffer.concat([jsonBuf0, Buffer.alloc((4 - (jsonBuf0.length % 4)) % 4, 0x20)]);
const binBuf = Buffer.concat(binChunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));

function chunk(type, data) {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
}
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, chunk(0x4e4f534a, jsonBuf), chunk(0x004e4942, binBuf)]));
console.log(
  `wrote ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes, ` +
    `${gltfNodes.length - 1} nodes, ${totalVerts} verts, ${totalTris} tris)`,
);
