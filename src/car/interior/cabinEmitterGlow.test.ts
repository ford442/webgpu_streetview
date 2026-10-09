import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  BASIC_GLOW_GAIN,
  SHADER_GLOW_GAIN,
  createCabinGlowSprite,
  setCabinGlowLevel,
} from './CabinEmitterGlow';
import { resetCabinMaterialBackendForTests } from './cabinMaterialBackend';

/**
 * The glow halos are additive quads parented into car-body space. On High
 * quality they use the dashboardGlow shader, whose falloff is measured from a
 * `glowCenter` uniform in *world* space — so the sprite has to keep that
 * uniform on itself every frame or the halo renders nothing (the default
 * center is ~2 m away from every fixture). Medium uses a MeshBasicMaterial
 * with a radial alpha map so the quad doesn't read as a square sticker.
 */
describe('cabin emitter glow sprites', () => {
  beforeEach(() => resetCabinMaterialBackendForTests());
  afterEach(() => vi.restoreAllMocks());

  const shaderSprite = (reducedMotion = false) =>
    createCabinGlowSprite({
      kind: 'dome',
      color: 0xffe8b0,
      width: 0.42,
      height: 0.42,
      useShader: true,
      reducedMotion,
    });

  /** Rotated + translated parent, like roofGroup / interiorGroup under chassis motion. */
  const parentUnder = (mesh: THREE.Mesh, yaw: number) => {
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    group.rotation.set(0.1, yaw, 0.02);
    group.position.set(0.3, -0.2, 1.1);
    group.add(mesh);
    mesh.position.set(0, 1.545, 0.3);
    return group;
  };

  it('moves the shader glow center onto the sprite in world space each update', () => {
    const sprite = shaderSprite();
    expect(sprite.uniforms).not.toBeNull();
    const center = sprite.uniforms!.glowCenter.value;
    // Stale shader default — nothing has placed it on the fixture yet.
    expect(center.distanceTo(new THREE.Vector3(0, -0.3, 0.5))).toBeLessThan(1e-6);

    const group = parentUnder(sprite.mesh, 0.6);
    setCabinGlowLevel(sprite, 0.5, 1, false);

    const expected = sprite.mesh.getWorldPosition(new THREE.Vector3());
    expect(expected.distanceTo(new THREE.Vector3(0, -0.3, 0.5))).toBeGreaterThan(1);
    expect(center.distanceTo(expected)).toBeLessThan(1e-6);

    // Chassis yawed: the halo follows the fixture, it does not stay where it was.
    group.rotation.y = -1.2;
    const before = center.clone();
    setCabinGlowLevel(sprite, 0.5, 2, false);
    expect(center.distanceTo(before)).toBeGreaterThan(0.1);
    expect(center.distanceTo(sprite.mesh.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
  });

  it('adds the premultiplied shader output linearly (One, One), not as glow²', () => {
    const sprite = shaderSprite();
    const mat = sprite.mesh.material as THREE.ShaderMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    // The fragment writes vec4(colour * glow, glow). Without this flag both
    // backends blend (SrcAlpha, One) and the faint ramp levels vanish.
    expect(mat.premultipliedAlpha).toBe(true);
    expect(mat.toneMapped).toBe(false);
  });

  it('scales shader intensity by the per-path gain and hides at a faint level', () => {
    const sprite = shaderSprite();
    parentUnder(sprite.mesh, 0);

    setCabinGlowLevel(sprite, 0.5, 3, false);
    expect(sprite.uniforms!.intensity.value).toBeCloseTo(0.5 * SHADER_GLOW_GAIN, 6);
    expect(sprite.uniforms!.time.value).toBe(3);
    expect(sprite.mesh.visible).toBe(true);

    setCabinGlowLevel(sprite, 0.01, 4, false);
    expect(sprite.mesh.visible).toBe(false);

    setCabinGlowLevel(sprite, 7, 5, false);
    expect(sprite.uniforms!.intensity.value).toBeCloseTo(SHADER_GLOW_GAIN, 6);
  });

  it('freezes the pulse under reduced motion', () => {
    const sprite = shaderSprite(true);
    parentUnder(sprite.mesh, 0);
    expect(sprite.uniforms!.pulseAmount.value).toBe(0);

    setCabinGlowLevel(sprite, 0.8, 9, true);
    expect(sprite.uniforms!.pulseAmount.value).toBe(0);
    expect(sprite.uniforms!.time.value).toBe(0);

    setCabinGlowLevel(sprite, 0.8, 9, false);
    expect(sprite.uniforms!.pulseAmount.value).toBeGreaterThan(0);
    expect(sprite.uniforms!.time.value).toBe(9);
  });

  it('drives the medium quad by opacity with the basic gain', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext' as never).mockReturnValue(null as never);
    const sprite = createCabinGlowSprite({
      kind: 'cluster',
      color: 0x4caf50,
      width: 0.6,
      height: 0.3,
      useShader: false,
      reducedMotion: false,
    });
    expect(sprite.uniforms).toBeNull();
    const mat = sprite.mesh.material as THREE.MeshBasicMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.transparent).toBe(true);

    setCabinGlowLevel(sprite, 0.5, 0, false);
    expect(mat.opacity).toBeCloseTo(0.5 * BASIC_GLOW_GAIN, 6);
    expect(sprite.mesh.visible).toBe(true);

    setCabinGlowLevel(sprite, 0.01, 0, false);
    expect(sprite.mesh.visible).toBe(false);
  });

  it('gives the medium quad a radial alpha map when a 2D canvas is available', () => {
    const gradient = { addColorStop: vi.fn() };
    const ctx = {
      createRadialGradient: vi.fn(() => gradient),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext' as never).mockReturnValue(ctx as never);

    const sprite = createCabinGlowSprite({
      kind: 'dome',
      color: 0xffe8b0,
      width: 0.42,
      height: 0.42,
      useShader: false,
      reducedMotion: false,
    });
    const mat = sprite.mesh.material as THREE.MeshBasicMaterial;
    expect(mat.alphaMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(gradient.addColorStop).toHaveBeenCalled();
    // Each sprite owns its own texture: CarInteriorDispose disposes alphaMap
    // per material, so a shared one would die with the first cabin teardown.
    const other = createCabinGlowSprite({
      kind: 'dome',
      color: 0xffe8b0,
      width: 0.42,
      height: 0.42,
      useShader: false,
      reducedMotion: false,
    });
    expect((other.mesh.material as THREE.MeshBasicMaterial).alphaMap).not.toBe(mat.alphaMap);
  });

  it('builds the medium quad without an alpha map when the canvas has no 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext' as never).mockReturnValue(null as never);
    const sprite = createCabinGlowSprite({
      kind: 'dome',
      color: 0xffe8b0,
      width: 0.42,
      height: 0.42,
      useShader: false,
      reducedMotion: false,
    });
    expect((sprite.mesh.material as THREE.MeshBasicMaterial).alphaMap).toBeNull();
  });
});
