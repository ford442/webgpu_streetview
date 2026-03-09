/**
 * Physics-based animation system for vehicle interior dynamics.
 * Uses spring physics (damped harmonic oscillators) to create realistic
 * steering, suspension, pedal, and head bob animations.
 */

// ============================================================
// Spring Physics
// ============================================================

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/**
 * Damped harmonic oscillator using semi-implicit Euler integration.
 *
 * Equation of motion:  x'' = -(k/m)*x - (c/m)*x'
 *   k = stiffness, c = damping, m = mass
 */
export class SpringPhysics {
  private position: number;
  private velocity: number;
  private config: SpringConfig;

  constructor(config: SpringConfig) {
    this.config = { ...config };
    this.position = 0;
    this.velocity = 0;
  }

  /** Replace the spring configuration, preserving current position. */
  setConfig(config: SpringConfig): void {
    this.config = { ...config };
  }

  /**
   * Advance the spring towards `target` by `deltaTime` seconds.
   * Returns the new position.
   */
  update(deltaTime: number, target: number): number {
    const dt = Math.min(deltaTime, 1 / 30); // cap to avoid instability
    const { stiffness, damping, mass } = this.config;

    const displacement = this.position - target;
    const acceleration = (-stiffness * displacement - damping * this.velocity) / mass;

    // Semi-implicit Euler: update velocity first, then position
    this.velocity += acceleration * dt;
    this.position += this.velocity * dt;

    return this.position;
  }

  getValue(): number {
    return this.position;
  }

  getVelocity(): number {
    return this.velocity;
  }

  reset(value: number = 0): void {
    this.position = value;
    this.velocity = 0;
  }
}

// ============================================================
// Suspension
// ============================================================

export interface SuspensionConfig {
  frontStiffness: number;
  rearStiffness: number;
  damping: number;
  maxTravel: number;
}

export interface SuspensionState {
  frontLeft: number;
  frontRight: number;
  rearLeft: number;
  rearRight: number;
  bodyRoll: number;
  bodyPitch: number;
}

// ============================================================
// Animation State
// ============================================================

export interface VehicleAnimationState {
  suspension: SuspensionState;
  steeringAngle: number;
  throttlePosition: number;
  brakePosition: number;
  gearShiftPosition: number;
  headBob: { x: number; y: number; z: number };
}

// ============================================================
// Default configs
// ============================================================

const DEFAULT_SUSPENSION: SuspensionConfig = {
  frontStiffness: 120,
  rearStiffness: 100,
  damping: 18,
  maxTravel: 0.08,
};

const STEERING_SPRING: SpringConfig = { stiffness: 300, damping: 25, mass: 1.2 };
const THROTTLE_SPRING: SpringConfig = { stiffness: 600, damping: 30, mass: 0.4 };
const BRAKE_SPRING: SpringConfig = { stiffness: 200, damping: 45, mass: 0.6 };
const GEAR_SHIFT_SPRING: SpringConfig = { stiffness: 400, damping: 35, mass: 0.8 };

const STEERING_MAX = 90;
const THROTTLE_MAX = 1;
const BRAKE_MAX = 1;

// ============================================================
// VehiclePhysicsAnimations
// ============================================================

/**
 * Manages all physics-based animations for a vehicle interior.
 *
 * Each subsystem (steering, suspension, pedals, gear shift, head bob)
 * runs an independent spring simulation so they can be updated and
 * queried individually or as a combined state snapshot.
 */
export class VehiclePhysicsAnimations {
  private enabled: boolean = true;
  private suspensionConfig: SuspensionConfig;

  // Spring instances
  private steeringSpring: SpringPhysics;
  private throttleSpring: SpringPhysics;
  private brakeSpring: SpringPhysics;
  private gearShiftSpring: SpringPhysics;

  // Suspension corner springs
  private suspFL: SpringPhysics;
  private suspFR: SpringPhysics;
  private suspRL: SpringPhysics;
  private suspRR: SpringPhysics;

  // Head bob accumulators
  private headBobPhase: number = 0;
  private headBobHighFreqPhase: number = 0;

  // Cached state
  private cachedSuspension: SuspensionState;
  private cachedHeadBob: { x: number; y: number; z: number };

  constructor() {
    this.suspensionConfig = { ...DEFAULT_SUSPENSION };

    this.steeringSpring = new SpringPhysics(STEERING_SPRING);
    this.throttleSpring = new SpringPhysics(THROTTLE_SPRING);
    this.brakeSpring = new SpringPhysics(BRAKE_SPRING);
    this.gearShiftSpring = new SpringPhysics(GEAR_SHIFT_SPRING);

    this.suspFL = new SpringPhysics({
      stiffness: DEFAULT_SUSPENSION.frontStiffness,
      damping: DEFAULT_SUSPENSION.damping,
      mass: 1,
    });
    this.suspFR = new SpringPhysics({
      stiffness: DEFAULT_SUSPENSION.frontStiffness,
      damping: DEFAULT_SUSPENSION.damping,
      mass: 1,
    });
    this.suspRL = new SpringPhysics({
      stiffness: DEFAULT_SUSPENSION.rearStiffness,
      damping: DEFAULT_SUSPENSION.damping,
      mass: 1,
    });
    this.suspRR = new SpringPhysics({
      stiffness: DEFAULT_SUSPENSION.rearStiffness,
      damping: DEFAULT_SUSPENSION.damping,
      mass: 1,
    });

    this.cachedSuspension = neutralSuspension();
    this.cachedHeadBob = { x: 0, y: 0, z: 0 };
  }

  // ----------------------------------------------------------
  // Suspension
  // ----------------------------------------------------------

  setSuspensionConfig(config: Partial<SuspensionConfig>): void {
    Object.assign(this.suspensionConfig, config);

    const rebuildCorner = (spring: SpringPhysics, stiffness: number): void => {
      spring.setConfig({ stiffness, damping: this.suspensionConfig.damping, mass: 1 });
    };

    rebuildCorner(this.suspFL, this.suspensionConfig.frontStiffness);
    rebuildCorner(this.suspFR, this.suspensionConfig.frontStiffness);
    rebuildCorner(this.suspRL, this.suspensionConfig.rearStiffness);
    rebuildCorner(this.suspRR, this.suspensionConfig.rearStiffness);
  }

  /**
   * Simulate suspension for one frame.
   * @param speed     Vehicle speed in km/h
   * @param roadQuality 0 = smooth, 1 = rough
   * @param deltaTime  Seconds since last frame
   */
  updateSuspension(speed: number, roadQuality: number, deltaTime: number): SuspensionState {
    if (!this.enabled) return this.cachedSuspension;

    const maxTravel = this.suspensionConfig.maxTravel;

    // Bump amplitude scales with road roughness and speed
    const speedFactor = Math.min(speed / 80, 1);
    const bumpAmplitude = roadQuality * maxTravel * speedFactor;

    // Generate per-corner random bump targets
    const bumpFL = randomBump(bumpAmplitude);
    const bumpFR = randomBump(bumpAmplitude);
    const bumpRL = randomBump(bumpAmplitude);
    const bumpRR = randomBump(bumpAmplitude);

    const fl = clamp(this.suspFL.update(deltaTime, bumpFL), -maxTravel, maxTravel);
    const fr = clamp(this.suspFR.update(deltaTime, bumpFR), -maxTravel, maxTravel);
    const rl = clamp(this.suspRL.update(deltaTime, bumpRL), -maxTravel, maxTravel);
    const rr = clamp(this.suspRR.update(deltaTime, bumpRR), -maxTravel, maxTravel);

    // Body roll from left/right difference (positive = lean right)
    const leftAvg = (fl + rl) / 2;
    const rightAvg = (fr + rr) / 2;
    const bodyRoll = (rightAvg - leftAvg) * 5; // scale to degrees-ish

    // Body pitch from front/rear difference (positive = nose down)
    const frontAvg = (fl + fr) / 2;
    const rearAvg = (rl + rr) / 2;
    const bodyPitch = (frontAvg - rearAvg) * 5;

    this.cachedSuspension = { frontLeft: fl, frontRight: fr, rearLeft: rl, rearRight: rr, bodyRoll, bodyPitch };
    return this.cachedSuspension;
  }

  // ----------------------------------------------------------
  // Steering
  // ----------------------------------------------------------

  /**
   * Move steering towards targetAngle (degrees, -90 to 90).
   * Returns the current interpolated angle.
   */
  updateSteering(targetAngle: number, deltaTime: number): number {
    if (!this.enabled) return this.steeringSpring.getValue();
    const clamped = clamp(targetAngle, -STEERING_MAX, STEERING_MAX);
    return clamp(this.steeringSpring.update(deltaTime, clamped), -STEERING_MAX, STEERING_MAX);
  }

  getSteeringAngle(): number {
    return this.steeringSpring.getValue();
  }

  // ----------------------------------------------------------
  // Pedals
  // ----------------------------------------------------------

  /**
   * Throttle pedal: quick engage, quick spring-return.
   * Returns 0..1 position.
   */
  updateThrottle(pressed: boolean, deltaTime: number): number {
    if (!this.enabled) return this.throttleSpring.getValue();
    const target = pressed ? THROTTLE_MAX : 0;
    return clamp(this.throttleSpring.update(deltaTime, target), 0, THROTTLE_MAX);
  }

  /**
   * Brake pedal: hydraulic feel — engages quickly, returns slowly.
   * Returns 0..1 position.
   */
  updateBrake(pressed: boolean, deltaTime: number): number {
    if (!this.enabled) return this.brakeSpring.getValue();
    const target = pressed ? BRAKE_MAX : 0;
    return clamp(this.brakeSpring.update(deltaTime, target), 0, BRAKE_MAX);
  }

  // ----------------------------------------------------------
  // Gear shift
  // ----------------------------------------------------------

  /**
   * Gear shift slides between discrete positions with detent resistance.
   * `targetPosition` is a normalised index (e.g. 0=P, 1=R, 2=N, 3=D).
   */
  updateGearShift(targetPosition: number, deltaTime: number): number {
    if (!this.enabled) return this.gearShiftSpring.getValue();

    // Snap target to nearest integer (detent)
    const detent = Math.round(targetPosition);
    return this.gearShiftSpring.update(deltaTime, detent);
  }

  // ----------------------------------------------------------
  // Head bob / camera shake
  // ----------------------------------------------------------

  /**
   * Combine low-frequency body sway with high-frequency road vibration.
   * Returns a displacement vector to add to the camera position.
   */
  updateHeadBob(speed: number, roadQuality: number, deltaTime: number): { x: number; y: number; z: number } {
    if (!this.enabled) return this.cachedHeadBob;

    const speedNorm = Math.min(speed / 100, 1);

    // Low-frequency sway (~1-2 Hz) — gentle body rocking
    const swayFreq = 1.5 + speedNorm * 0.5;
    this.headBobPhase += swayFreq * deltaTime * Math.PI * 2;

    // High-frequency vibration (~8-15 Hz) — road surface
    const vibeFreq = 8 + roadQuality * 7;
    this.headBobHighFreqPhase += vibeFreq * deltaTime * Math.PI * 2;

    // Keep phases bounded to avoid floating-point drift
    if (this.headBobPhase > Math.PI * 200) this.headBobPhase -= Math.PI * 200;
    if (this.headBobHighFreqPhase > Math.PI * 200) this.headBobHighFreqPhase -= Math.PI * 200;

    const swayAmp = 0.003 * speedNorm;
    const vibeAmp = 0.001 * roadQuality * speedNorm;

    this.cachedHeadBob = {
      x: Math.sin(this.headBobPhase) * swayAmp + Math.sin(this.headBobHighFreqPhase * 1.3) * vibeAmp,
      y: Math.sin(this.headBobPhase * 2) * swayAmp * 0.6 + Math.sin(this.headBobHighFreqPhase) * vibeAmp,
      z: Math.cos(this.headBobPhase * 0.7) * swayAmp * 0.3 + Math.cos(this.headBobHighFreqPhase * 0.9) * vibeAmp * 0.5,
    };

    return this.cachedHeadBob;
  }

  // ----------------------------------------------------------
  // Aggregate state
  // ----------------------------------------------------------

  /** Snapshot of every animated value for applying to Three.js objects. */
  getState(): VehicleAnimationState {
    return {
      suspension: { ...this.cachedSuspension },
      steeringAngle: this.steeringSpring.getValue(),
      throttlePosition: this.throttleSpring.getValue(),
      brakePosition: this.brakeSpring.getValue(),
      gearShiftPosition: this.gearShiftSpring.getValue(),
      headBob: { ...this.cachedHeadBob },
    };
  }

  reset(): void {
    this.steeringSpring.reset();
    this.throttleSpring.reset();
    this.brakeSpring.reset();
    this.gearShiftSpring.reset();
    this.suspFL.reset();
    this.suspFR.reset();
    this.suspRL.reset();
    this.suspRR.reset();
    this.headBobPhase = 0;
    this.headBobHighFreqPhase = 0;
    this.cachedSuspension = neutralSuspension();
    this.cachedHeadBob = { x: 0, y: 0, z: 0 };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// ============================================================
// Helpers
// ============================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomBump(amplitude: number): number {
  return (Math.random() * 2 - 1) * amplitude;
}

function neutralSuspension(): SuspensionState {
  return { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0, bodyRoll: 0, bodyPitch: 0 };
}
