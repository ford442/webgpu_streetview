import * as THREE from 'three';
import {
  createDashboardGlowGlslMaterial,
  createDashboardGlowUniforms,
  type DashboardGlowUniforms,
} from '../../shaders/dashboardGlow';
import { getCabinMaterialBackend } from './cabinMaterialBackend';
import { getCabinTslApi } from './cabinTslRegistry';

export type CabinGlowKind = 'cluster' | 'dome';

export interface CabinGlowSprite {
  mesh: THREE.Mesh;
  kind: CabinGlowKind;
  uniforms: DashboardGlowUniforms | null;
  baseColor: THREE.Color;
}

/**
 * Per-path gains for the ramp `level` (cabinLightingRamps). The two paths put
 * the same level on screen very differently: Medium is a flat additive
 * opacity across the quad, High is the shader's peak intensity at the halo
 * centre with an untonemapped additive add on WebGPU — so each gets its own
 * knob, and the ramp curves stay the single source of *when* a halo lifts.
 */
export const BASIC_GLOW_GAIN = 0.45;
export const SHADER_GLOW_GAIN = 0.55;
/** Breathing amplitude of the shader halo; 0 under reduced motion. */
export const GLOW_PULSE_AMOUNT = 0.08;

/**
 * Radial white→black gradient for the Medium quad's alphaMap, so the additive
 * add falls off toward the quad edge instead of stopping at a hard square.
 * One texture per sprite: `disposeCarInteriorResources` disposes `alphaMap`
 * per material, so a module-shared texture would die on the first teardown.
 * Returns null where there is no 2D canvas (jsdom) — the quad still works,
 * just without the falloff.
 */
function radialAlphaTexture(size = 64): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.55, '#8c8c8c');
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function additiveBasic(color: THREE.Color): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    alphaMap: radialAlphaTexture(),
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function additiveGlow(
  color: THREE.Color,
  reducedMotion: boolean,
): { material: THREE.Material; uniforms: DashboardGlowUniforms } {
  const uniforms = createDashboardGlowUniforms();
  uniforms.glowColor.value.copy(color);
  uniforms.intensity.value = 0;
  uniforms.pulseAmount.value = reducedMotion ? 0 : GLOW_PULSE_AMOUNT;
  uniforms.pulseSpeed.value = 1.1;
  uniforms.glowRadius.value = 0.28;
  uniforms.falloff.value = 2.4;
  const backend = getCabinMaterialBackend();
  const tsl = backend === 'webgpu' ? getCabinTslApi() : undefined;
  const material = tsl
    ? tsl.createDashboardGlowMaterial(uniforms)
    : createDashboardGlowGlslMaterial(uniforms);
  return { material, uniforms: (tsl ? material.uniforms : uniforms) as DashboardGlowUniforms };
}

/**
 * Soft additive quad for cluster bezels / dome fixture.
 * Medium: MeshBasicMaterial with a radial alphaMap. High: dashboardGlow shader /
 * TSL twin (tight radius). Parent to the interior group so glow stays in
 * car-body space.
 */
export function createCabinGlowSprite(opts: {
  kind: CabinGlowKind;
  color: number;
  width: number;
  height: number;
  useShader: boolean;
  reducedMotion: boolean;
}): CabinGlowSprite {
  const color = new THREE.Color(opts.color);
  let material: THREE.Material;
  let uniforms: CabinGlowSprite['uniforms'] = null;
  if (opts.useShader) {
    const shader = additiveGlow(color, opts.reducedMotion);
    material = shader.material;
    uniforms = shader.uniforms;
  } else {
    material = additiveBasic(color);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(opts.width, opts.height), material);
  mesh.name = opts.kind === 'dome' ? 'cabinDomeGlow' : 'cabinClusterGlow';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, kind: opts.kind, uniforms, baseColor: color };
}

/**
 * Per-frame drive from CarInteriorLightingManager (runs after the animator has
 * posed the chassis / roof for this frame). The shader measures its falloff
 * from `glowCenter` in world space, so the sprite re-centres that uniform on
 * itself every call — the chassis yaws and the roof slides, and a halo left at
 * the shader default sits ~2 m from every fixture and renders nothing.
 */
export function setCabinGlowLevel(
  sprite: CabinGlowSprite,
  level: number,
  timeSec: number,
  reducedMotion: boolean,
): void {
  const t = Math.max(0, Math.min(1, level));
  if (sprite.uniforms) {
    sprite.mesh.getWorldPosition(sprite.uniforms.glowCenter.value);
    sprite.uniforms.intensity.value = t * SHADER_GLOW_GAIN;
    sprite.uniforms.time.value = reducedMotion ? 0 : timeSec;
    sprite.uniforms.pulseAmount.value = reducedMotion ? 0 : GLOW_PULSE_AMOUNT;
    sprite.mesh.visible = t > 0.02;
    return;
  }
  const mat = sprite.mesh.material as THREE.MeshBasicMaterial;
  mat.opacity = t * BASIC_GLOW_GAIN;
  sprite.mesh.visible = t > 0.02;
}
