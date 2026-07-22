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
  private wipersActive = false;
  private lastRain = 0;
  private lastCondensation = 0;

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

  private refreshVisibility(): void {
    // Keep the overlay up while wiping so the clear arc is visible even if
    // WeatherPanel rain is at zero (blades alone are easy to miss).
    this.mesh.visible =
      this.wipersActive || this.lastRain > 0.02 || this.lastCondensation > 0.04;
  }

  setWeather(rainNorm: number, fogNorm: number, humidity = 0): void {
    const u = this.material.uniforms;
    this.lastRain = Math.max(0, Math.min(1, rainNorm));
    u.rainIntensity!.value = this.lastRain;
    this.lastCondensation = Math.max(
      0,
      Math.min(1, fogNorm * 0.65 + humidity * 0.35 + rainNorm * 0.15),
    );
    u.condensation!.value = this.lastCondensation;
    // While wiping with a dry windshield, seed a light mist so the clear path reads.
    if (this.wipersActive && this.lastRain < 0.08) {
      u.rainIntensity!.value = 0.12;
    }
    this.refreshVisibility();
  }

  setWipersActive(active: boolean, phase: number): void {
    const u = this.material.uniforms;
    this.wipersActive = active;
    u.wiperActive!.value = active;
    this.wiperPhase = phase;
    u.wiperPhase!.value = phase;
    if (active && this.lastRain < 0.08) {
      u.rainIntensity!.value = 0.12;
    }
    this.refreshVisibility();
  }

  update(deltaTime: number): void {
    const u = this.material.uniforms;
    u.time!.value += deltaTime;
    if (u.wiperActive!.value) {
      this.wiperPhase = (this.wiperPhase + deltaTime * 0.55) % 1;
      u.wiperPhase!.value = this.wiperPhase;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
