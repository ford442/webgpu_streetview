import * as THREE from 'three';

/**
 * Sun-visor vanity mirror — samples the Street View pano with a tight,
 * downward-biased crop and horizontal flip (like RearviewMirror, smaller RT).
 */
export class VanityMirror {
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly mirrorMaterial: THREE.ShaderMaterial;
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
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    mirrorPlane: THREE.Mesh
  ) {
    this.renderTarget = new THREE.WebGLRenderTarget(VanityMirror.WIDTH, VanityMirror.HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    this.mirrorMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        warmth: { value: 0.18 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float warmth;
        varying vec2 vUv;
        void main() {
          vec2 uv = vec2(1.0 - vUv.x, vUv.y);
          vec3 color = texture2D(tDiffuse, uv).rgb;
          color = mix(color, color * vec3(1.05, 0.98, 0.92), warmth);
          float edge = smoothstep(0.45, 0.2, distance(vUv, vec2(0.5)));
          color *= mix(0.75, 1.0, edge);
          gl_FragColor = vec4(color, 0.92);
        }
      `,
      transparent: true,
    });

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
    this.renderer.setRenderTarget(currentTarget);
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.mirrorMaterial.dispose();
    this.mirrorScreenMesh.geometry.dispose();
    this.mirrorScreenMat.dispose();
    this.streetViewTexture?.dispose();
  }
}
