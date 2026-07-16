import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { GPUPerformanceProfile } from '../../utils/performance';

export interface MaterialSet {
  dashboard: THREE.MeshPhysicalMaterial;
  leather: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshPhysicalMaterial;
  frame: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  mirror: THREE.MeshStandardMaterial;
  accent: THREE.MeshPhysicalMaterial;
  chrome: THREE.MeshPhysicalMaterial;
}

/** Generate a procedural canvas texture */
function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Convert a tiling height field into a tangent-space normal map
 * (Sobel filter, wrapped edges so the texture stays seamless).
 */
function normalMapFromHeight(
  size: number,
  height: Float32Array,
  strength: number
): THREE.CanvasTexture {
  return canvasTexture(size, (ctx) => {
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const h = (x: number, y: number) =>
      height[((y + size) % size) * size + ((x + size) % size)]!;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx =
          (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) -
          (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
        const dy =
          (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) -
          (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
        const nx = -dx * strength;
        const ny = -dy * strength;
        const len = Math.sqrt(nx * nx + ny * ny + 1);
        const i = (y * size + x) * 4;
        d[i] = ((nx / len) * 0.5 + 0.5) * 255;
        d[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** Leather grain height field, with two dashed stitch rows that tile into seam lines. */
function leatherHeightField(size: number): Float32Array {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fine = (Math.random() - 0.5) * 0.5;
      const coarse =
        Math.sin(x * 0.18 + y * 0.1) * Math.cos(x * 0.1 - y * 0.15) * 0.35;
      field[y * size + x] = fine + coarse;
    }
  }
  // Stitch bumps: dashes of raised thread just inside the top and bottom edges,
  // sunk into a shallow seam groove.
  const stitchRows = [Math.floor(size * 0.06), Math.floor(size * 0.94)];
  const dash = Math.floor(size / 16);
  for (const row of stitchRows) {
    for (let x = 0; x < size; x++) {
      for (let dyOff = -2; dyOff <= 2; dyOff++) {
        field[(row + dyOff) * size + x] -= 0.5; // seam groove
      }
      if (x % dash < dash * 0.55) {
        field[row * size + x] += 1.6; // raised thread
        field[(row - 1) * size + x] += 0.9;
        field[(row + 1) * size + x] += 0.9;
      }
    }
  }
  return field;
}

/** Brushed-metal roughness map: fine horizontal streaks over a polished base. */
function brushedMetalRoughnessTexture(size: number): THREE.CanvasTexture {
  return canvasTexture(size, (ctx) => {
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      const streak = 50 + Math.random() * 40;
      for (let x = 0; x < size; x++) {
        const v = streak + (Math.random() - 0.5) * 18;
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.max(30, Math.min(120, v));
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ---------------------------------------------------------------------------
// Cabin glow registry: every emissive trim/backlight material registers its
// authored base intensity here, and the lighting manager scales them all with
// one call per frame — accent strips brighten at night, button backlights
// come up with the headlights, and the whole set breathes together. No extra
// lights are involved; it's pure emissive modulation.
// ---------------------------------------------------------------------------

interface GlowEntry {
  material: THREE.MeshStandardMaterial;
  base: number;
}

let glowRegistry: GlowEntry[] = [];

/** Drop all registered glow materials (call before rebuilding an interior). */
export function resetGlowRegistry(): void {
  glowRegistry = [];
}

/** Register an emissive material whose glow should follow cabin state. */
export function registerGlowMaterial(
  material: THREE.MeshStandardMaterial,
  baseIntensity: number
): void {
  glowRegistry.push({ material, base: baseIntensity });
}

/**
 * Scale every registered glow material for the current cabin state.
 * @param night        0-1 effective night factor
 * @param headlightsOn instrument/backlight bump when the lights are on
 * @param breathe      small ±modulation for the ambient breathing effect
 */
export function setCabinGlowState(
  night: number,
  headlightsOn: boolean,
  breathe: number
): void {
  const scale = 1 + night * 1.1 + (headlightsOn ? 0.25 : 0) + breathe;
  for (const entry of glowRegistry) {
    entry.material.emissiveIntensity = entry.base * scale;
  }
}

/**
 * Lacquered accent trim material. Clearcoat gives the pieces a sharp
 * reflection of the panorama environment on top of the tinted base, and the
 * emissive term makes the trim read as ambient accent lighting. Callers pass
 * different `emissiveIntensity` values so trim pieces vary in glow (bezels
 * brighter than long strips); the neon theme boosts all of them. Each accent
 * material joins the glow registry so cabin state modulates it.
 */
export function createAccentMaterial(
  config: VehicleConfig,
  emissiveIntensity: number
): THREE.MeshPhysicalMaterial {
  const accentHex = parseInt(config.accentColor.replace('#', '0x'));
  const themeBoost = config.theme === 'neon' ? 1.6 : 1;
  const material = new THREE.MeshPhysicalMaterial({
    color: accentHex,
    roughness: 0.3,
    metalness: 0.65,
    emissive: accentHex,
    emissiveIntensity: emissiveIntensity * themeBoost,
    envMapIntensity: 0.8,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
    side: THREE.DoubleSide,
  });
  registerGlowMaterial(material, emissiveIntensity * themeBoost);
  return material;
}

/** Create all interior materials from vehicle config + GPU profile */
export function createMaterials(
  config: VehicleConfig,
  gpuProfile: GPUPerformanceProfile
): MaterialSet {
  const detailMaps = gpuProfile.name !== 'low';

  // Leather texture (multi-scale grain)
  const leatherTex = canvasTexture(256, (ctx) => {
    const img = ctx.createImageData(256, 256);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const px = (i / 4) % 256;
      const py = Math.floor(i / 4 / 256);
      const fine = (Math.random() - 0.5) * 22;
      const coarse =
        Math.sin(px * 0.18 + py * 0.1) *
        Math.cos(px * 0.1 - py * 0.15) *
        10;
      const micro = Math.sin(px * 0.9) * Math.cos(py * 0.7) * 3;
      const v = 58 + fine + coarse + micro;
      data[i] = Math.max(30, Math.min(115, v));
      data[i + 1] = Math.max(18, Math.min(82, v * 0.71));
      data[i + 2] = Math.max(8, Math.min(55, v * 0.54));
      data[i + 3] = 255;
    }
    // Stitch thread color where the height field raises the seam dashes
    const dash = 16;
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(196,168,120,0.9)';
    for (const row of [Math.floor(256 * 0.06), Math.floor(256 * 0.94)]) {
      for (let x = 0; x < 256; x += dash) {
        ctx.fillRect(x, row - 1, dash * 0.55, 3);
      }
    }
  });
  leatherTex.repeat.set(3, 3);
  leatherTex.anisotropy = gpuProfile.name === 'high' ? 8 : 4;

  const leatherNormalTex = detailMaps
    ? normalMapFromHeight(256, leatherHeightField(256), 1.4)
    : null;
  leatherNormalTex?.repeat.set(3, 3);

  // Dashboard soft-touch texture
  const dashTex = canvasTexture(128, (ctx) => {
    const img = ctx.createImageData(128, 128);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = (Math.random() * 8) | 0;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  dashTex.repeat.set(4, 4);

  let dashNormalTex: THREE.CanvasTexture | null = null;
  if (detailMaps) {
    const grain = new Float32Array(128 * 128);
    for (let i = 0; i < grain.length; i++) grain[i] = Math.random();
    dashNormalTex = normalMapFromHeight(128, grain, 0.35);
    dashNormalTex.repeat.set(4, 4);
  }

  const dashboardColors: Record<string, number> = {
    dark: 0x1a1a1a,
    light: 0x2a2a2a,
    neon: 0x0a0a1a,
    clinical: 0xf0f0f0,
  };
  const dashColor = dashboardColors[config.theme] ?? 0x1a1a1a;
  const clinical = config.theme === 'clinical';

  // Soft-touch dash: near-dielectric with a faint sheen so grazing light
  // picks up the matte-plastic look; clinical theme reads as hard gloss.
  const dashboard = new THREE.MeshPhysicalMaterial({
    color: dashColor,
    map: clinical ? null : dashTex,
    normalMap: clinical ? null : dashNormalTex,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: clinical ? 0.35 : 0.88,
    metalness: clinical ? 0.15 : 0.04,
    clearcoat: clinical ? 0.6 : 0.0,
    clearcoatRoughness: 0.25,
    sheen: clinical ? 0 : 0.25,
    sheenRoughness: 0.9,
    sheenColor: new THREE.Color(0x222222),
    envMapIntensity: 0.4,
    side: THREE.DoubleSide,
  });

  const leather = new THREE.MeshPhysicalMaterial({
    map: leatherTex,
    normalMap: leatherNormalTex,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.78,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0x3a2a1a),
    envMapIntensity: 0.2,
    side: THREE.DoubleSide,
  });

  // Brushed metal: streaked roughness map breaks up reflections along the grain.
  const metal = new THREE.MeshPhysicalMaterial({
    color: clinical ? 0xd4d4d4 : 0x969696,
    roughness: detailMaps ? 1.0 : 0.22,
    roughnessMap: detailMaps ? brushedMetalRoughnessTexture(128) : null,
    metalness: 0.88,
    envMapIntensity: 1,
    side: THREE.DoubleSide,
  });

  const frame = new THREE.MeshStandardMaterial({
    color: clinical ? 0xeeeeee : 0x131313,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.15,
    side: THREE.DoubleSide,
  });

  const glass = new THREE.MeshStandardMaterial({
    color: 0x99b8cc,
    roughness: 0.08,
    metalness: 0.6,
    transparent: true,
    opacity: 0.45,
    envMapIntensity: 1.2,
    side: THREE.FrontSide,
  });

  const mirror = new THREE.MeshStandardMaterial({
    color: 0xe0e8ec,
    roughness: 0.04,
    metalness: 1,
    envMapIntensity: 1.5,
    side: THREE.FrontSide,
  });

  const accent = createAccentMaterial(config, 0.2);

  // Polished chrome for vent surrounds, rings, handles.
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xe8e8e8,
    roughness: 0.08,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.4,
  });

  return { dashboard, leather, metal, frame, glass, mirror, accent, chrome };
}
