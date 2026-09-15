import * as THREE from 'three';
import type { CabinRenderer } from './createCabinRenderer';
import { createVanityMirrorGlslMaterial, type VanityMirrorUniforms } from '../../shaders/vanityMirror';
import { getCabinTslApi } from './cabinTslRegistry';

/**
 * Duplicated from `createCabinRenderer.ts`'s `isWebGPUCabinRenderer` rather
 * than imported: importing it here — for whatever reason in Rollup's
 * automatic chunking of this particular module graph — pulls the shared
 * `three` runtime into the eager main bundle (verified: main.js gzip goes
 * from ~350 KiB to ~430 KiB, over `scripts/check-bundle-budget.sh`'s cap,
 * even though nothing here touches `three/webgpu`). This predicate has no
 * dependencies of its own, so a local copy is cheap insurance.
 */
function isWebGPUCabinRenderer(renderer: CabinRenderer): boolean {
  return (renderer as { isWebGPURenderer?: boolean }).isWebGPURenderer === true;
}

type VanityMaterial = THREE.Material & { uniforms: VanityMirrorUniforms };

/**
 * Sun-visor vanity mirror — samples the Street View pano with a tight,
 * downward-biased crop and horizontal flip (like RearviewMirror, smaller RT).
 */
export class VanityMirror {
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly mirrorMaterial: VanityMaterial;
  private readonly mirrorPlane: THREE.Mesh;
  private readonly mirrorScreenScene: THREE.Scene;
  private readonly mirrorScreenMesh: THREE.Mesh;
  private readonly mirrorScreenMat: THREE.MeshBasicMaterial;
  private readonly mirrorCamera: THREE.PerspectiveCamera;
  private streetViewTexture: THREE.CanvasTexture | null = null;
  private streetViewCanvas: HTMLCanvasElement | null = null;
  private frameCount = 0;

  private static readonly WIDTH = 256;
  private static readonly HEIGHT = 160;

  constructor(
    _scene: THREE.Scene,
    private readonly renderer: CabinRenderer,
    mirrorPlane: THREE.Mesh
  ) {
    this.renderTarget = new THREE.WebGLRenderTarget(VanityMirror.WIDTH, VanityMirror.HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    const webgpu = isWebGPUCabinRenderer(renderer);
    const tsl = webgpu ? getCabinTslApi() : undefined;
    this.mirrorMaterial = (tsl
      ? tsl.createVanityMirrorMaterial(this.renderTarget.texture)
      : createVanityMirrorGlslMaterial(this.renderTarget.texture)) as VanityMaterial;

    this.mirrorPlane = mirrorPlane;
    this.mirrorPlane.material = this.mirrorMaterial;

    this.mirrorCamera = new THREE.PerspectiveCamera(60, VanityMirror.WIDTH / VanityMirror.HEIGHT, 0.1, 100);
    this.mirrorCamera.position.set(0, 0, 1);

    this.mirrorScreenScene = new THREE.Scene();
    this.mirrorScreenMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.mirrorScreenMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), this.mirrorScreenMat);
    this.mirrorScreenScene.add(this.mirrorScreenMesh);
  }

  setStreetViewCanvas(canvas: HTMLCanvasElement | null): void {
    if (canvas === this.streetViewCanvas) return;
    this.streetViewCanvas = canvas;

    if (!canvas) {
      this.streetViewTexture = null;
      this.mirrorScreenMat.map = null;
      return;
    }

    if (!this.streetViewTexture) {
      this.streetViewTexture = new THREE.CanvasTexture(canvas);
      this.streetViewTexture.minFilter = THREE.LinearFilter;
      this.streetViewTexture.magFilter = THREE.LinearFilter;
      this.streetViewTexture.wrapS = THREE.RepeatWrapping;
      this.streetViewTexture.repeat.set(-0.35, 0.42);
      this.mirrorScreenMat.map = this.streetViewTexture;
    } else {
      this.streetViewTexture.image = canvas;
      this.streetViewTexture.needsUpdate = true;
    }
  }

  /** Vanity shows a forward-down slice of the pano (driver-facing reflection illusion). */
  update(viewHeading: number, headPitch: number, skipFrame = true): void {
    this.frameCount++;
    if (skipFrame && this.frameCount % 3 !== 0) return;
    if (!this.streetViewCanvas || !this.streetViewTexture) return;

    this.streetViewTexture.needsUpdate = true;
    const headingOffset = (viewHeading % 360) / 360;
    const pitchBias = THREE.MathUtils.clamp((headPitch + 15) / 90, -0.08, 0.12);
    this.streetViewTexture.offset.x = 0.52 + headingOffset * 0.08;
    this.streetViewTexture.offset.y = 0.38 + pitchBias;

    const currentTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.clear();
    this.renderer.render(this.mirrorScreenScene, this.mirrorCamera);
    // `getRenderTarget()`/`setRenderTarget()` round-trip the same renderer's own
    // value; the two `CabinRenderer` union members type this pair slightly
    // differently, so re-narrow rather than fight the union.
    this.renderer.setRenderTarget(currentTarget as ReturnType<THREE.WebGLRenderer['getRenderTarget']>);
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.mirrorMaterial.dispose();
    this.mirrorScreenMesh.geometry.dispose();
    this.mirrorScreenMat.dispose();
    this.streetViewTexture?.dispose();
  }
}
