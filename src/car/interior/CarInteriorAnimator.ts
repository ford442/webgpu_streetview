import * as THREE from 'three';
import { LODManager } from './LODManager';
import { RainSystem } from './RainSystem';
import { DustMoteSystem } from './DustMoteSystem';
import { WindowWeatherOverlay } from './WindowWeatherOverlay';
import { InteriorMicroInteractions } from './InteriorMicroInteractions';
import {
    GaugeRig,
    needleAngle,
    SPEED_DIAL_MAX_KMH,
    TACHO_DIAL_MAX_RPM,
} from './CarInteriorGauges';
import { getWindAudio } from '../../effects/WindAudio';
import { wiperLowQualityOnPose, wiperParkPose } from '../carSpatialModel';

export interface CarInteriorAmbientState {
  rainNorm: number;
  windNorm: number;
  fogNorm: number;
  humidityNorm: number;
  sunVisibility: number;
  lightShaftFactor: number;
  carSpeedKmh: number;
  convertibleOpen: boolean;
}

/** Parked pause between intermittent wiper sweeps (seconds). */
const INTERMITTENT_DWELL_S = 2.5;

export class CarInteriorAnimator {
  private steeringAngle: number = 0;
  private isWiperActive: boolean = false;
  private wiperAnimationTime: number = 0;
  private wiperSpeed: number = 1.0;
  private wiperIntermittent: boolean = false;
  /** Seconds left of the parked pause between intermittent sweeps. */
  private wiperDwell: number = 0;
  private speedometer: number = 0;
  private tachometer: number = 0;
  private isActive: boolean = true;
  private roofTargetY: number = 0;
  private ambientTime = 0;
  private ambient: CarInteriorAmbientState = {
    rainNorm: 0,
    windNorm: 0,
    fogNorm: 0,
    humidityNorm: 0,
    sunVisibility: 0.4,
    lightShaftFactor: 0.35,
    carSpeedKmh: 0,
    convertibleOpen: false,
  };
  private cupSlosh = 0;
  private cupLiquidMaterial?: THREE.ShaderMaterial;

  // Gauge rig (from dashboard polish) — spring-driven needles + fuel/temp
  private gaugeRig: GaugeRig | null = null;
  private targetSpeed: number = 0;
  private targetRpm: number = 0;
  private speedFrac: number = 0;
  private rpmFrac: number = 0;
  private fuelLevel: number = 0.85;
  private tempFrac: number = 0.05;
  private gaugeClock: number = 0;
  private nightFactor: number = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private interiorGroup: THREE.Group,
    private roofGroup: THREE.Group,
    private steeringWheelGroup: THREE.Group | null,
    private wiperLeft: THREE.Group | null,
    private wiperRight: THREE.Group | null,
    private speedometerNeedle: THREE.Mesh | null | undefined,
    private tachometerNeedle: THREE.Mesh | null | undefined,
    private lodManager: LODManager,
    private rainSystem: RainSystem | undefined,
    private dustMotes: DustMoteSystem | undefined,
    private windowOverlay: WindowWeatherOverlay | undefined,
    private microInteractions: InteriorMicroInteractions | undefined,
    private lodUpdateFn: (() => void) | undefined,
    private quality: 'high' | 'medium' | 'low',
    private reducedMotion: boolean
  ) {}

  public setCupLiquidMaterial(material: THREE.ShaderMaterial | undefined): void {
    this.cupLiquidMaterial = material;
  }

  public setAmbientState(state: Partial<CarInteriorAmbientState>): void {
    this.ambient = { ...this.ambient, ...state };
    const { rainNorm, fogNorm, humidityNorm, sunVisibility, lightShaftFactor } = this.ambient;

    const dustVisibility = sunVisibility * (0.35 + lightShaftFactor * 0.65);
    this.dustMotes?.setSunVisibility(dustVisibility);
    this.rainSystem?.setIntensity(rainNorm);
    this.rainSystem?.setActive(rainNorm > 0.04);
    this.windowOverlay?.setWeather(rainNorm, fogNorm, humidityNorm);
  }

  public update(deltaTime: number, carSpeedKmh = 0): void {
    this.ambient.carSpeedKmh = carSpeedKmh;
    this.ambientTime += deltaTime;
    const wiperPhase = this.wiperAnimationTime % 1;

    this.windowOverlay?.setWipersActive(this.isWiperActive, wiperPhase);
    this.windowOverlay?.update(deltaTime);
    this.dustMotes?.update(deltaTime, this.ambientTime);
    this.microInteractions?.update(deltaTime);

    if (this.cupLiquidMaterial) {
      this.cupLiquidMaterial.uniforms.time!.value = this.ambientTime;
      const targetSlosh = THREE.MathUtils.clamp(carSpeedKmh / 45, 0, 1);
      this.cupSlosh += (targetSlosh - this.cupSlosh) * Math.min(deltaTime * 4, 1);
      this.cupLiquidMaterial.uniforms.slosh!.value = this.cupSlosh;
    }

    this.syncWindAudio();

    if (this.reducedMotion) {
      this.roofGroup.position.y = this.roofTargetY;
      if (this.steeringWheelGroup) {
        this.steeringWheelGroup.rotation.z = this.steeringAngle;
      }
      // Reduced-motion: still show a distinct static "on" pose so the toggle
      // is visible (park pose alone looked identical to off).
      this.syncStaticWiperPose();
      if (this.quality !== 'low') this.updateGauges(deltaTime);
      if (this.lodUpdateFn) this.lodUpdateFn();
      this.lodManager.updateLOD(this.camera);
      return;
    }

    const clampedDelta = Math.min(deltaTime, 0.1);

    const currentY = this.roofGroup.position.y;
    const diff = this.roofTargetY - currentY;
    if (Math.abs(diff) > 0.001) {
      this.roofGroup.position.y += diff * Math.min(clampedDelta * 3, 1);
    }

    if (this.steeringWheelGroup) {
      const steerDiff = this.steeringAngle - this.steeringWheelGroup.rotation.z;
      let shortestDiff = steerDiff;
      if (shortestDiff > Math.PI) shortestDiff -= Math.PI * 2;
      if (shortestDiff < -Math.PI) shortestDiff += Math.PI * 2;
      this.steeringWheelGroup.rotation.z += shortestDiff * Math.min(clampedDelta * 5, 1);
    }

    if (this.isWiperActive) {
      if (this.quality === 'low') {
        // Low quality: no blade animation, but hold a raised "on" pose so the
        // HUD/stalk toggle is still visibly reflected in the cabin.
        this.syncStaticWiperPose();
      } else if (this.wiperDwell > 0) {
        this.wiperDwell -= clampedDelta;
        this.parkWipers();
      } else {
        const before = this.wiperAnimationTime;
        this.wiperAnimationTime += clampedDelta * this.wiperSpeed;
        if (this.wiperIntermittent && Math.floor(this.wiperAnimationTime) > Math.floor(before)) {
          // Land exactly on the park position, then pause before the next sweep.
          this.wiperAnimationTime = Math.floor(this.wiperAnimationTime);
          this.wiperDwell = INTERMITTENT_DWELL_S;
        }
        const wiperCycle = this.wiperAnimationTime % 1.0;
        const wiperAngle = Math.sin(wiperCycle * Math.PI) * (Math.PI / 4);
        if (this.wiperLeft) this.wiperLeft.rotation.z = -wiperAngle - Math.PI / 6;
        if (this.wiperRight) this.wiperRight.rotation.z = wiperAngle + Math.PI / 6;
      }
    }

    if (this.quality !== 'low') this.updateGauges(clampedDelta);
    if (this.lodUpdateFn) this.lodUpdateFn();
    this.lodManager.updateLOD(this.camera);
    if (this.rainSystem) this.rainSystem.update(deltaTime);
  }

  private syncWindAudio(): void {
    const wind = getWindAudio();
    const speedFromWind = this.ambient.windNorm * 80;
    const speed = Math.max(this.ambient.carSpeedKmh, speedFromWind);
    const shouldPlay = this.ambient.convertibleOpen || this.ambient.windNorm > 0.25;
    if (shouldPlay) {
      if (!wind.isPlaying()) {
        void wind.init().then((ok) => {
          if (ok) {
            void wind.start();
          }
        });
      } else {
        wind.update(speed);
      }
    } else if (wind.isPlaying()) {
      wind.stop();
    }
  }

  private updateGauges(dt?: number): void {
    const rig = this.gaugeRig;
    if (rig) {
      const useDt = dt ?? 0.016;
      this.gaugeClock += useDt;
      const t = this.gaugeClock;
      const speedTargetFrac = this.targetSpeed / SPEED_DIAL_MAX_KMH;
      const rpmTargetFrac = this.targetRpm / TACHO_DIAL_MAX_RPM;

      if (this.reducedMotion) {
        this.speedFrac = speedTargetFrac;
        this.rpmFrac = rpmTargetFrac;
        rig.speedNeedle.rotation.z = needleAngle(this.speedFrac);
        rig.tachoNeedle.rotation.z = needleAngle(this.rpmFrac);
      } else {
        const roadWobble =
          (Math.sin(t * 29.7) + Math.sin(t * 17.3) * 0.6) *
          0.0035 * Math.min(1, this.speedFrac * 2.5);
        const engineWobble = Math.sin(t * 47.1) * 0.004 * (0.2 + this.rpmFrac);
        // simple spring toward targets (kept lightweight; full spring in updateGauges path too)
        this.speedFrac += (speedTargetFrac - this.speedFrac) * Math.min(1, useDt * 8);
        this.rpmFrac += (rpmTargetFrac - this.rpmFrac) * Math.min(1, useDt * 12);
        rig.speedNeedle.rotation.z = needleAngle(this.speedFrac + roadWobble);
        rig.tachoNeedle.rotation.z = needleAngle(this.rpmFrac + engineWobble);
      }

      // fuel + temp (simplified)
      const speedKmh = this.speedFrac * SPEED_DIAL_MAX_KMH;
      this.fuelLevel = Math.max(0.06, this.fuelLevel - speedKmh * useDt * 1.4e-5);
      const tempTarget = speedKmh > 1 || this.rpmFrac > 0.15 ? Math.min(0.8, 0.5 + this.rpmFrac * 0.35) : 0.05;
      this.tempFrac += (tempTarget - this.tempFrac) * Math.min(1, useDt * 0.6);
      if (rig.fuelNeedle) rig.fuelNeedle.rotation.z = needleAngle(this.fuelLevel);
      if (rig.tempNeedle) rig.tempNeedle.rotation.z = needleAngle(this.tempFrac);

      const breathe = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.6);
      const dialGlow = 0.22 + this.nightFactor * 0.55 + breathe * 0.05 + this.rpmFrac * 0.1;
      for (const mat of rig.dialMaterials) mat.emissiveIntensity = dialGlow;
      const needleGlow = 0.85 + this.nightFactor * 0.9 + breathe * 0.12 + this.rpmFrac * 0.4;
      for (const mat of rig.needleMaterials) mat.emissiveIntensity = needleGlow;
      return;
    }

    // legacy needle path (no-op if the static helper was removed; rig path is authoritative)
    if (this.speedometerNeedle && this.tachometerNeedle) {
      // best-effort direct rotation using old state numbers
      const s = Math.max(0, Math.min(1, this.speedometer / SPEED_DIAL_MAX_KMH));
      const r = Math.max(0, Math.min(1, this.tachometer / 8000));
      this.speedometerNeedle.rotation.z = -0.8 + s * 1.6; // rough
      this.tachometerNeedle.rotation.z = -0.8 + r * 1.6;
    }
  }

  public setActive(active: boolean): void {
    this.isActive = active;
  }

  public setCarOrientation(carHeading: number, bodyPitch: number = 0, bodyRoll: number = 0): void {
    const safePitch = this.isActive ? bodyPitch : 0;
    const safeRoll = this.isActive ? bodyRoll : 0;
    const yawRad = -THREE.MathUtils.degToRad(carHeading);
    const pitchRad = THREE.MathUtils.degToRad(safePitch);
    const rollRad = THREE.MathUtils.degToRad(safeRoll);
    this.interiorGroup.rotation.set(pitchRad, yawRad, rollRad);
  }

  public setHeadOrientation(headYaw: number, headPitch: number): void {
    const clampedPitch = Math.max(-45, Math.min(65, headPitch));
    const localYaw = -THREE.MathUtils.degToRad(headYaw);
    const localPitch = -THREE.MathUtils.degToRad(clampedPitch);
    this.camera.rotation.set(localPitch, localYaw, 0);
  }

  public setSteeringAngle(angle: number): void {
    this.steeringAngle = THREE.MathUtils.degToRad(Math.max(-90, Math.min(90, angle)));
  }

  public setWipersActive(active: boolean): void {
    this.isWiperActive = active;
    if (this.rainSystem) this.rainSystem.setWipersActive(active);
    if (!active) {
      this.wiperAnimationTime = 0;
      this.wiperDwell = 0;
      this.parkWipers();
    } else if (this.quality === 'low' || this.reducedMotion) {
      // Immediately reflect "on" for quality gates that skip the sweep animation.
      this.syncStaticWiperPose();
    }
  }

  /** Whether blades are currently requested on (HUD/stalk SSOT). */
  public getWipersActive(): boolean {
    return this.isWiperActive;
  }

  /** Sweep rate multiplier (0.5 = slow, 1 = normal, 2 = fast). */
  public setWiperSpeed(speed: number): void {
    this.wiperSpeed = Math.max(0.5, Math.min(2.0, speed));
  }

  /** Intermittent mode pauses at the park position between single sweeps. */
  public setWiperIntermittent(intermittent: boolean): void {
    if (this.wiperIntermittent === intermittent) return;
    this.wiperIntermittent = intermittent;
    this.wiperDwell = 0;
  }

  private parkWipers(): void {
    const pose = wiperParkPose();
    if (this.wiperLeft) this.wiperLeft.rotation.z = pose.left;
    if (this.wiperRight) this.wiperRight.rotation.z = pose.right;
  }

  /**
   * Static pose for low-quality / reduced-motion: raised "on" when active so
   * the toggle is visible without running the sweep animation; park when off.
   */
  private syncStaticWiperPose(): void {
    if (!this.isWiperActive) {
      this.parkWipers();
      return;
    }
    const pose = wiperLowQualityOnPose();
    if (this.wiperLeft) this.wiperLeft.rotation.z = pose.left;
    if (this.wiperRight) this.wiperRight.rotation.z = pose.right;
  }

  public setGaugeValues(speed: number, rpm: number): void {
    this.speedometer = Math.max(0, Math.min(SPEED_DIAL_MAX_KMH, speed));
    this.tachometer = Math.max(0, Math.min(TACHO_DIAL_MAX_RPM, rpm));
    this.targetSpeed = Math.max(0, Math.min(SPEED_DIAL_MAX_KMH, speed));
    this.targetRpm = Math.max(0, Math.min(TACHO_DIAL_MAX_RPM, rpm));
  }

  public setRoofTargetY(y: number): void {
    this.roofTargetY = y;
  }

  /** Swap in the live gauge handles (called after every interior build). */
  public setGaugeRig(rig: GaugeRig | null): void {
    this.gaugeRig = rig;
  }

  /** 0-1 night intensity; drives gauge backlight brightness. */
  public setNightFactor(night: number): void {
    this.nightFactor = Math.max(0, Math.min(1, night));
  }

  /** Called by external dynamics to drive target values for spring sim. */
  // (setGaugeValues already exists and sets the legacy speedo/tacho)
}
