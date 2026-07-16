import * as THREE from 'three';

/**
 * ConvertibleState - Interface for managing convertible vehicle state
 */
export interface ConvertibleState {
  isOpen: boolean;
  windSpeed: number;
  turbulence: number;
  windDeflectorDeployed: boolean;
}

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

/**
 * ConvertibleInterior - Manages the convertible-specific interior features
 */
export class ConvertibleInterior {
  private interiorGroup: THREE.Group;
  private windDeflectorGroup: THREE.Group;
  private windDeflectorDeployed: boolean = false;

  constructor(interiorGroup: THREE.Group) {
    this.interiorGroup = interiorGroup;
    this.windDeflectorGroup = new THREE.Group();
    this.buildWindDeflector();
  }

  private buildWindDeflector(): void {
    // Wind deflector frame (behind seats, reduces cabin turbulence)
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.6,
      metalness: 0.3,
      transparent: true,
      opacity: 0.9,
    });

    const meshMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    // Deflector frame
    const frameGeo = new THREE.BoxGeometry(1.8, 0.04, 0.04);
    const topFrame = new THREE.Mesh(frameGeo, frameMat);
    topFrame.position.set(0, 1.35, 0.8);
    this.windDeflectorGroup.add(topFrame);

    const sideFrameGeo = new THREE.BoxGeometry(0.04, 0.3, 0.04);
    const leftSide = new THREE.Mesh(sideFrameGeo, frameMat);
    leftSide.position.set(-0.9, 1.2, 0.8);
    this.windDeflectorGroup.add(leftSide);

    const rightSide = new THREE.Mesh(sideFrameGeo, frameMat);
    rightSide.position.set(0.9, 1.2, 0.8);
    this.windDeflectorGroup.add(rightSide);

    // Mesh screen
    const meshGeo = new THREE.PlaneGeometry(1.8, 0.3);
    const mesh = new THREE.Mesh(meshGeo, meshMat);
    mesh.position.set(0, 1.2, 0.8);
    this.windDeflectorGroup.add(mesh);

    // Initially hidden
    this.windDeflectorGroup.visible = false;
    this.interiorGroup.add(this.windDeflectorGroup);
  }

  /**
   * Toggle wind deflector deployment
   */
  toggleWindDeflector(): boolean {
    this.windDeflectorDeployed = !this.windDeflectorDeployed;
    this.windDeflectorGroup.visible = this.windDeflectorDeployed;
    return this.windDeflectorDeployed;
  }

  /**
   * Get current wind deflector state
   */
  isWindDeflectorDeployed(): boolean {
    return this.windDeflectorDeployed;
  }

  /**
   * Show/hide wind deflector
   */
  setWindDeflectorVisible(visible: boolean): void {
    this.windDeflectorGroup.visible = visible && this.windDeflectorDeployed;
  }
}

/**
 * SportDashboard - Sportier dashboard variant for convertible mode
 */
export class SportDashboard {
  private interiorGroup: THREE.Group;
  private sportElements: THREE.Group;

  constructor(interiorGroup: THREE.Group) {
    this.interiorGroup = interiorGroup;
    this.sportElements = new THREE.Group();
    this.buildSportDashboard();
  }

  private buildSportDashboard(): void {
    const sportMat = new THREE.MeshStandardMaterial({
      color: 0x8b0000, // Dark red accent
      roughness: 0.6,
      metalness: 0.2,
    });

    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.4,
      metalness: 0.1,
    });

    // Sport trim on dashboard
    const trimGeo = new THREE.BoxGeometry(1.8, 0.02, 0.3);
    const trim = new THREE.Mesh(trimGeo, sportMat);
    trim.position.set(0, 0.82, -0.9);
    this.sportElements.add(trim);

    // Carbon fiber center console extension
    const consoleGeo = new THREE.BoxGeometry(0.25, 0.4, 0.9);
    const console = new THREE.Mesh(consoleGeo, carbonMat);
    console.position.set(0, 0.55, 0.1);
    this.sportElements.add(console);

    // Sport gauge pod (triple gauge setup)
    const podGeo = new THREE.BoxGeometry(0.4, 0.15, 0.15);
    const pod = new THREE.Mesh(podGeo, carbonMat);
    pod.position.set(0.5, 0.98, -0.8);
    pod.rotation.x = -0.1;
    this.sportElements.add(pod);

    // Individual gauges in pod
    const gaugeGeo = new THREE.CircleGeometry(0.04, 16);
    const gaugeMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0x330000,
      emissiveIntensity: 0.3,
    });

    for (let i = 0; i < 3; i++) {
      const gauge = new THREE.Mesh(gaugeGeo, gaugeMat);
      gauge.position.set(0.4 + i * 0.1, 0.98, -0.72);
      this.sportElements.add(gauge);
    }

    this.interiorGroup.add(this.sportElements);
  }

  /**
   * Show/hide sport dashboard elements
   */
  setVisible(visible: boolean): void {
    this.sportElements.visible = visible;
  }
}

/**
 * SportSeats - Sport bucket seats for convertible mode
 */
export class SportSeats {
  private seatsGroup: THREE.Group;

  constructor(_interiorGroup: THREE.Group) {
    this.seatsGroup = new THREE.Group();
    this.buildSportSeats();
  }

  private buildSportSeats(): void {
    // Sport seat material - racing style
    const seatMat = new THREE.MeshStandardMaterial({
      color: 0x4a0000, // Deep red racing leather
      roughness: 0.5,
      metalness: 0.1,
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.7,
      metalness: 0.0,
    });

    // Driver sport seat - bucket style with high bolsters
    this.buildSportBucket(-0.35, seatMat, accentMat);
    // Passenger sport seat
    this.buildSportBucket(0.45, seatMat, accentMat);
  }

  private buildSportBucket(xPos: number, seatMat: THREE.MeshStandardMaterial, accentMat: THREE.MeshStandardMaterial): void {
    // Seat bottom - contoured bucket
    const bottomGeo = new THREE.BoxGeometry(0.45, 0.12, 0.5);
    const bottom = new THREE.Mesh(bottomGeo, seatMat);
    bottom.position.set(xPos, 0.46, 0.2);
    this.seatsGroup.add(bottom);

    // Side bolsters (bottom)
    const bolsterGeo = new THREE.BoxGeometry(0.08, 0.15, 0.5);
    const leftBolster = new THREE.Mesh(bolsterGeo, accentMat);
    leftBolster.position.set(xPos - 0.2, 0.5, 0.2);
    leftBolster.rotation.z = -0.15;
    this.seatsGroup.add(leftBolster);

    const rightBolster = new THREE.Mesh(bolsterGeo, accentMat);
    rightBolster.position.set(xPos + 0.2, 0.5, 0.2);
    rightBolster.rotation.z = 0.15;
    this.seatsGroup.add(rightBolster);

    // Seat back - high wraparound
    const backGeo = new THREE.BoxGeometry(0.45, 0.75, 0.1);
    const back = new THREE.Mesh(backGeo, seatMat);
    back.position.set(xPos, 0.95, 0.55);
    back.rotation.x = -0.2;
    this.seatsGroup.add(back);

    // Back side bolsters
    const backBolsterGeo = new THREE.BoxGeometry(0.1, 0.6, 0.12);
    const leftBackBolster = new THREE.Mesh(backBolsterGeo, accentMat);
    leftBackBolster.position.set(xPos - 0.2, 1.0, 0.55);
    leftBackBolster.rotation.x = -0.2;
    leftBackBolster.rotation.z = -0.1;
    this.seatsGroup.add(leftBackBolster);

    const rightBackBolster = new THREE.Mesh(backBolsterGeo, accentMat);
    rightBackBolster.position.set(xPos + 0.2, 1.0, 0.55);
    rightBackBolster.rotation.x = -0.2;
    rightBackBolster.rotation.z = 0.1;
    this.seatsGroup.add(rightBackBolster);

    // Headrest - integrated sport style
    const headrestGeo = new THREE.BoxGeometry(0.3, 0.2, 0.1);
    const headrest = new THREE.Mesh(headrestGeo, accentMat);
    headrest.position.set(xPos, 1.45, 0.52);
    headrest.rotation.x = -0.1;
    this.seatsGroup.add(headrest);

    // Racing stripe/detail on seat
    const stripeGeo = new THREE.BoxGeometry(0.08, 0.7, 0.02);
    const stripe = new THREE.Mesh(stripeGeo, accentMat);
    stripe.position.set(xPos, 1.0, 0.61);
    stripe.rotation.x = -0.2;
    this.seatsGroup.add(stripe);
  }

  /**
   * Show/hide sport seats
   */
  setVisible(visible: boolean): void {
    this.seatsGroup.visible = visible;
  }

  /**
   * Get the seats group for adding to scene
   */
  getGroup(): THREE.Group {
    return this.seatsGroup;
  }
}

/**
 * VehicleType - Enum for vehicle types
 * Local vehicle type enum for convertible internal use
 * Note: This is distinct from the global VehicleType type alias in VehicleManager
 */
enum VehicleType {
  SEDAN = 'sedan',
  CONVERTIBLE = 'convertible',
}
type LocalVehicleType = VehicleType;

/**
 * ConvertibleMode - Main class for managing convertible vehicle mode
 */
export class ConvertibleMode {
  private interiorGroup: THREE.Group;
  private roofGroup: THREE.Group;
  private windParticles: WindParticleSystem;
  private convertibleInterior: ConvertibleInterior;
  private sportDashboard: SportDashboard;
  private sportSeats: SportSeats;

  private state: ConvertibleState = {
    isOpen: true,
    windSpeed: 0,
    turbulence: 0.5,
    windDeflectorDeployed: false,
  };

  private vehicleType: VehicleType = VehicleType.CONVERTIBLE;

  constructor(
    scene: THREE.Scene,
    interiorGroup: THREE.Group,
    roofGroup: THREE.Group
  ) {
    this.interiorGroup = interiorGroup;
    this.roofGroup = roofGroup;

    // Initialize components
    this.windParticles = new WindParticleSystem(scene);
    this.convertibleInterior = new ConvertibleInterior(interiorGroup);
    this.sportDashboard = new SportDashboard(interiorGroup);
    this.sportSeats = new SportSeats(interiorGroup);

    // Remove roof by default for convertible mode
    this.roofGroup.visible = false;

    // Add sport elements to scene
    this.interiorGroup.add(this.sportSeats.getGroup());

    // Initialize as convertible (no roof, sport features)
    this.applyVehicleType(VehicleType.CONVERTIBLE);
  }

  /**
   * Set the vehicle type (sedan or convertible)
   */
  setVehicleType(type: LocalVehicleType): void {
    if (this.vehicleType === type) return;
    this.vehicleType = type;
    this.applyVehicleType(type);
  }

  /**
   * Toggle between sedan and convertible modes
   */
  toggleVehicleType(): VehicleType {
    const newType = this.vehicleType === VehicleType.SEDAN ? VehicleType.CONVERTIBLE : VehicleType.SEDAN;
    this.setVehicleType(newType);
    return newType;
  }

  /**
   * Get current vehicle type
   */
  getVehicleType(): VehicleType {
    return this.vehicleType;
  }

  /**
   * Apply vehicle type settings
   */
  private applyVehicleType(type: VehicleType): void {
    if (type === VehicleType.CONVERTIBLE) {
      // Convertible mode: no roof, sport features, wind effects
      this.roofGroup.visible = false;
      this.state.isOpen = true;
      this.sportDashboard.setVisible(true);
      this.sportSeats.setVisible(true);
      this.windParticles.setActive(true);
      this.convertibleInterior.setWindDeflectorVisible(true);
    } else {
      // Sedan mode: roof on, standard features, no wind
      this.roofGroup.visible = true;
      this.state.isOpen = false;
      this.sportDashboard.setVisible(false);
      this.sportSeats.setVisible(false);
      this.windParticles.setActive(false);
      this.convertibleInterior.setWindDeflectorVisible(false);
    }
  }

  /**
   * Toggle the convertible roof (only relevant in convertible mode)
   */
  toggleRoof(): boolean {
    if (this.vehicleType !== VehicleType.CONVERTIBLE) {
      console.warn('Cannot toggle roof in sedan mode');
      return false;
    }
    this.state.isOpen = !this.state.isOpen;
    this.roofGroup.visible = !this.state.isOpen;
    return this.state.isOpen;
  }

  /**
   * Toggle wind deflector
   */
  toggleWindDeflector(): boolean {
    const deployed = this.convertibleInterior.toggleWindDeflector();
    this.state.windDeflectorDeployed = deployed;
    return deployed;
  }

  /**
   * Set wind speed (affects particle intensity)
   */
  setWindSpeed(speed: number): void {
    this.state.windSpeed = Math.max(0, Math.min(100, speed));
    this.windParticles.setTurbulence(this.state.turbulence * (this.state.windSpeed / 50));
  }

  /**
   * Set wind turbulence
   */
  setTurbulence(turbulence: number): void {
    this.state.turbulence = Math.max(0, Math.min(1, turbulence));
    this.windParticles.setTurbulence(this.state.turbulence);
  }

  /**
   * Update convertible mode elements
   * @param deltaTime - Time since last frame
   * @param carSpeed - Current car speed for wind effects
   */
  update(deltaTime: number, carSpeed: number): void {
    if (this.vehicleType === VehicleType.CONVERTIBLE && this.state.isOpen) {
      this.windParticles.update(deltaTime, carSpeed);
    }
  }

  /**
   * Get current convertible state
   */
  getState(): ConvertibleState {
    return { ...this.state };
  }

  /**
   * Check if currently in convertible mode with open roof
   */
  isConvertibleOpen(): boolean {
    return this.vehicleType === VehicleType.CONVERTIBLE && this.state.isOpen;
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    this.windParticles.dispose();
  }
}

export default ConvertibleMode;
