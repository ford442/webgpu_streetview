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

function additiveBasic(color: THREE.Color): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
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
  uniforms.pulseAmount.value = reducedMotion ? 0 : 0.08;
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
 * Medium: MeshBasicMaterial. High: dashboardGlow shader / TSL twin (tight radius).
 * Parent to the interior group so glow stays in car-body space.
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

export function setCabinGlowLevel(
  sprite: CabinGlowSprite,
  level: number,
  timeSec: number,
  reducedMotion: boolean,
): void {
  const t = Math.max(0, Math.min(1, level));
  if (sprite.uniforms) {
    sprite.uniforms.intensity.value = t;
    sprite.uniforms.time.value = reducedMotion ? 0 : timeSec;
    sprite.uniforms.pulseAmount.value = reducedMotion ? 0 : 0.08;
    sprite.mesh.visible = t > 0.02;
    return;
  }
  const mat = sprite.mesh.material as THREE.MeshBasicMaterial;
  mat.opacity = t * 0.45;
  sprite.mesh.visible = t > 0.02;
}
