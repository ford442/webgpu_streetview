import * as THREE from 'three';

/**
 * Windshield rain droplet particle system using InstancedMesh.
 * Droplets slide down the glass and reset to the top.
 * Disabled when wipers are active (wipers clear the glass).
 */
export class RainSystem {
  private mesh: THREE.InstancedMesh;
  private count: number;
  private positions: Float32Array;
  private velocities: Float32Array;
  private active: boolean;
  private dummy = new THREE.Object3D();
  private wipersActive = false;

  constructor(count = 200) {
    this.count = count;
    this.active = false;

    // Small elongated spheres for droplets
    const geo = new THREE.SphereGeometry(0.003, 6, 4);
    geo.scale(1, 2.5, 1);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xaaccff,
      transparent: true,
      opacity: 0.6,
      roughness: 0.1,
      metalness: 0.1,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.visible = false;

    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count);

    // Initialize random positions on windshield area
    for (let i = 0; i < count; i++) {
      this.resetDrop(i);
    }
  }

  getMesh(): THREE.InstancedMesh {
    return this.mesh;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.mesh.visible = active && !this.wipersActive;
  }

  setWipersActive(active: boolean): void {
    this.wipersActive = active;
    if (this.active) {
      this.mesh.visible = !active;
    }
  }

  update(deltaTime: number): void {
    if (!this.active || this.wipersActive) return;

    const dt = Math.min(deltaTime, 0.1);
    for (let i = 0; i < this.count; i++) {
      // Slide down
      this.positions[i * 3 + 1] -= this.velocities[i] * dt;

      // Slight horizontal wiggle
      this.positions[i * 3] += Math.sin(i * 7.3 + performance.now() * 0.001) * 0.0002;

      // Reset if below windshield
      if (this.positions[i * 3 + 1] < -0.3) {
        this.resetDrop(i);
      }

      this.dummy.position.set(
        this.positions[i * 3],
        this.positions[i * 3 + 1],
        this.positions[i * 3 + 2]
      );
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private resetDrop(i: number): void {
    // Windshield area: x ∈ [-0.8, 0.8], y ∈ [0.2, 1.0], z ≈ -0.72
    this.positions[i * 3] = (Math.random() - 0.5) * 1.6;
    this.positions[i * 3 + 1] = 0.2 + Math.random() * 0.8;
    this.positions[i * 3 + 2] = -0.72 + Math.random() * 0.01;
    this.velocities[i] = 0.08 + Math.random() * 0.15;

    this.dummy.position.set(
      this.positions[i * 3],
      this.positions[i * 3 + 1],
      this.positions[i * 3 + 2]
    );
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
