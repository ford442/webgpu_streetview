import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { GPUPerformanceProfile } from '../../utils/performance';

export interface MaterialSet {
  dashboard: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  mirror: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
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

/** Create all interior materials from vehicle config + GPU profile */
export function createMaterials(
  config: VehicleConfig,
  gpuProfile: GPUPerformanceProfile
): MaterialSet {
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
    ctx.putImageData(img, 0, 0);
  });
  leatherTex.repeat.set(3, 3);
  leatherTex.anisotropy = gpuProfile.name === 'high' ? 8 : 4;

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

  const dashboardColors: Record<string, number> = {
    dark: 0x1a1a1a,
    light: 0x2a2a2a,
    neon: 0x0a0a1a,
    clinical: 0xf0f0f0,
  };
  const dashColor = dashboardColors[config.theme] ?? 0x1a1a1a;

  const dashboard = new THREE.MeshStandardMaterial({
    color: dashColor,
    map: config.theme === 'clinical' ? null : dashTex,
    roughness: config.theme === 'clinical' ? 0.35 : 0.88,
    metalness: config.theme === 'clinical' ? 0.15 : 0.04,
    envMapIntensity: 0.4,
    side: THREE.DoubleSide,
  });

  const leather = new THREE.MeshStandardMaterial({
    map: leatherTex,
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.2,
    side: THREE.DoubleSide,
  });

  const metal = new THREE.MeshStandardMaterial({
    color: config.theme === 'clinical' ? 0xd4d4d4 : 0x969696,
    roughness: 0.22,
    metalness: 0.88,
    envMapIntensity: 1,
    side: THREE.DoubleSide,
  });

  const frame = new THREE.MeshStandardMaterial({
    color: config.theme === 'clinical' ? 0xeeeeee : 0x131313,
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

  const accent = new THREE.MeshStandardMaterial({
    color: parseInt(config.accentColor.replace('#', '0x')),
    roughness: 0.35,
    metalness: 0.65,
    emissive: parseInt(config.accentColor.replace('#', '0x')),
    emissiveIntensity: 0.2,
    envMapIntensity: 0.8,
    side: THREE.DoubleSide,
  });

  return { dashboard, leather, metal, frame, glass, mirror, accent };
}
