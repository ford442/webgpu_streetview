import * as THREE from 'three';
import {
  createWindowWeatherOverlayMaterial,
} from '../../shaders/windowWeatherOverlay';

/**
 * Transparent shader decal on the windshield — rain streaks + condensation.
 * Driven by WeatherPanel rain/fog; wiper phase synced from CarInteriorAnimator.
 */
export class WindowWeatherOverlay {
  private mesh!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;
  private wiperPhase = 0;

  constructor(windshield: THREE.Mesh) {
    const geometry = windshield.geometry.clone();
    this.material = createWindowWeatherOverlayMaterial();
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'windowWeatherOverlay';
    this.mesh.position.copy(windshield.position);
    this.mesh.rotation.copy(windshield.rotation);
    this.mesh.scale.copy(windshield.scale);
    // Nudge toward cabin so it draws on top of glass without z-fighting.
    this.mesh.position.z += 0.012;
    this.mesh.renderOrder = 1;
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  setWeather(rainNorm: number, fogNorm: number, humidity = 0): void {
    const u = this.material.uniforms;
    u.rainIntensity.value = Math.max(0, Math.min(1, rainNorm));
    const condensation = Math.max(0, Math.min(1, fogNorm * 0.65 + humidity * 0.35 + rainNorm * 0.15));
    u.condensation.value = condensation;
    this.mesh.visible = rainNorm > 0.02 || condensation > 0.04;
  }

  setWipersActive(active: boolean, phase: number): void {
    const u = this.material.uniforms;
    u.wiperActive.value = active;
    this.wiperPhase = phase;
    u.wiperPhase.value = phase;
  }

  update(deltaTime: number): void {
    const u = this.material.uniforms;
    u.time.value += deltaTime;
    if (u.wiperActive.value) {
      this.wiperPhase = (this.wiperPhase + deltaTime * 0.55) % 1;
      u.wiperPhase.value = this.wiperPhase;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
