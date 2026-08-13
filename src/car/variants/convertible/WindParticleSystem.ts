import * as THREE from 'three';

/**
 * WindParticleSystem - Manages wind particle effects for convertible mode
 */
export class WindParticleSystem {
  private scene: THREE.Scene;
  private particles: THREE.Points;
  private particleCount: number = 300;
  private particleGeometry: THREE.BufferGeometry;
  private particleMaterial: THREE.PointsMaterial;
  private positions: Float32Array;
  private velocities: Float32Array;
  private lifetimes: Float32Array;
  private isActive: boolean = false;
  private windSpeed: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create particle geometry
    this.particleGeometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);
    this.lifetimes = new Float32Array(this.particleCount);

    // Initialize particles randomly
    this.resetParticles();

    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    // Create particle material
    this.particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.03,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particles.visible = false;
    this.scene.add(this.particles);
  }

  private resetParticles(): void {
    for (let i = 0; i < this.particleCount; i++) {
      this.resetParticle(i);
    }
  }

  private resetParticle(index: number): void {
    const i3 = index * 3;
    // Spawn particles in front of the car, moving toward the cabin
    this.positions[i3] = (Math.random() - 0.5) * 4; // x: spread across width
    this.positions[i3 + 1] = 1.0 + Math.random() * 1.5; // y: height above ground
    this.positions[i3 + 2] = -3 - Math.random() * 5; // z: in front of car

    // Velocity based on wind speed
    const speed = this.windSpeed > 0 ? this.windSpeed : 20;
    this.velocities[i3] = (Math.random() - 0.5) * 2; // slight x turbulence
    this.velocities[i3 + 1] = (Math.random() - 0.5) * 1; // slight y variation
    this.velocities[i3 + 2] = speed * (0.8 + Math.random() * 0.4); // main z velocity

    this.lifetimes[index] = 1.0 + Math.random() * 2.0; // lifetime in seconds
  }

  /**
   * Update wind particle animation
   * @param deltaTime - Time since last frame in seconds
   * @param carSpeed - Current car speed (affects wind intensity)
   */
  update(deltaTime: number, carSpeed: number): void {
    if (!this.isActive) return;

    // Update wind speed based on car speed
    this.windSpeed = Math.max(10, carSpeed * 2);

    const positionAttr = this.particleGeometry.attributes.position;
    if (!positionAttr) return;
    const positions = positionAttr.array as Float32Array;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Update position based on velocity
      positions[i3] = (positions[i3] ?? 0) + (this.velocities[i3] ?? 0) * deltaTime;
      positions[i3 + 1] = (positions[i3 + 1] ?? 0) + (this.velocities[i3 + 1] ?? 0) * deltaTime;
      positions[i3 + 2] = (positions[i3 + 2] ?? 0) + (this.velocities[i3 + 2] ?? 0) * deltaTime;

      // Decrease lifetime
      this.lifetimes[i] = (this.lifetimes[i] ?? 0) - deltaTime;

      // Reset if expired or passed the cabin
      if ((this.lifetimes[i] ?? 0) <= 0 || (positions[i3 + 2] ?? 0) > 2) {
        this.resetParticle(i);
      }
    }

    positionAttr.needsUpdate = true;
  }

  /**
   * Activate/deactivate wind particles
   */
  setActive(active: boolean): void {
    this.isActive = active;
    this.particles.visible = active;
  }

  /**
   * Set wind turbulence intensity
   */
  setTurbulence(turbulence: number): void {
    this.particleMaterial.opacity = 0.2 + turbulence * 0.3;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
    this.scene.remove(this.particles);
  }
}
