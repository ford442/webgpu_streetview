import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass';
import { GPUPerformanceProfile } from '../../utils/performance';

/**
 * Manages optional post-processing stack for the car interior scene.
 * Bloom for neon / night glow, SMAA for anti-aliasing.
 * Automatically downgrades on low-end GPUs.
 */
export class PostProcessingManager {
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private enabled = true;
  private bloomStrength = 0.4;
  private gpuProfile: GPUPerformanceProfile;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    gpuProfile: GPUPerformanceProfile
  ) {
    this.gpuProfile = gpuProfile;
    this.composer = new EffectComposer(renderer);

    // Render pass — clear with transparent alpha so the WebGPU panorama shows through window openings
    const renderPass = new RenderPass(scene, camera);
    renderPass.clearColor = new THREE.Color(0x000000);
    renderPass.clearAlpha = 0;
    this.composer.addPass(renderPass);

    // Bloom — disabled on low-end GPUs
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4, // strength
      0.5, // radius
      0.85 // threshold
    );
    this.bloomPass.enabled = gpuProfile.name !== 'low';
    this.composer.addPass(this.bloomPass);

    // SMAA anti-aliasing — light on performance, good visual payoff
    const smaaPass = new SMAAPass();
    smaaPass.enabled = gpuProfile.name !== 'low';
    this.composer.addPass(smaaPass);

    // Output pass (tone mapping + sRGB)
    this.composer.addPass(new OutputPass());

    // On low-end, skip post-processing entirely for fps
    if (gpuProfile.name === 'low') {
      this.enabled = false;
    }
  }

  /** Render one frame through the post-processing pipeline. */
  render(): void {
    if (this.enabled) {
      this.composer.render();
    }
  }

  /** Toggle bloom on/off. */
  setBloom(enabled: boolean): void {
    this.bloomPass.enabled = enabled && this.gpuProfile.name !== 'low';
  }

  /** Adjust bloom intensity (0–1). */
  setBloomStrength(strength: number): void {
    this.bloomStrength = Math.max(0, Math.min(1, strength));
    this.bloomPass.strength = this.bloomStrength;
  }

  /** Enable/disable the entire post-processing stack. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.gpuProfile.name !== 'low';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Resize composer targets on window resize. */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
