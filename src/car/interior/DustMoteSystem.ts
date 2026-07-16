import * as THREE from 'three';

/**
 * Low-count cabin dust motes that catch sun / dome light. Cheap Points pass —
 * no compute shader needed at this particle budget.
 */
export class DustMoteSystem {
  private readonly points: THREE.Points;
  private readonly count: number;
  private readonly basePositions: Float32Array;
  private readonly phases: Float32Array;
  private sunVisibility = 0.5;
  private active = true;

  constructor(count = 56) {
    this.count = count;
    const positions = new Float32Array(count * 3);
    this.basePositions = new Float32Array(count * 3);
    this.phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 1.4;
      const y = 0.75 + Math.random() * 0.75;
      const z = -0.35 + Math.random() * 1.1;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      this.basePositions[i * 3] = x;
      this.basePositions[i * 3 + 1] = y;
      this.basePositions[i * 3 + 2] = z;
      this.phases[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xfff4d6,
      size: 0.012,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  getObject(): THREE.Points {
    return this.points;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.points.visible = active;
  }

  /** 0–1 from sun altitude / light-shaft visibility. */
  setSunVisibility(visibility: number): void {
    this.sunVisibility = Math.max(0, Math.min(1, visibility));
    const mat = this.points.material as THREE.PointsMaterial;
    mat.opacity = 0.08 + this.sunVisibility * 0.28;
    mat.size = 0.008 + this.sunVisibility * 0.01;
  }

  update(deltaTime: number, time: number): void {
    if (!this.active) return;
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const dt = Math.min(deltaTime, 0.1);
    const t = time * 0.35;

    for (let i = 0; i < this.count; i++) {
      const phase = this.phases[i]!;
      const bx = this.basePositions[i * 3]!;
      const by = this.basePositions[i * 3 + 1]!;
      const bz = this.basePositions[i * 3 + 2]!;
      attr.setXYZ(
        i,
        bx + Math.sin(t + phase) * 0.04,
        by + Math.cos(t * 0.7 + phase * 1.3) * 0.025 + dt * 0.002,
        bz + Math.sin(t * 0.5 + phase * 0.8) * 0.03
      );
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
