import * as THREE from 'three';
import { LODManager } from './LODManager';
import { RainSystem } from './RainSystem';
import { DustMoteSystem } from './DustMoteSystem';
import { WindowWeatherOverlay } from './WindowWeatherOverlay';
import { InteriorMicroInteractions } from './InteriorMicroInteractions';
import { CarInteriorGauges } from './CarInteriorGauges';
import { getWindAudio } from '../../effects/WindAudio';

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

export class CarInteriorAnimator {
  private steeringAngle: number = 0;
  private isWiperActive: boolean = false;
  private wiperAnimationTime: number = 0;
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
      this.cupLiquidMaterial.uniforms.time.value = this.ambientTime;
      const targetSlosh = THREE.MathUtils.clamp(carSpeedKmh / 45, 0, 1);
      this.cupSlosh += (targetSlosh - this.cupSlosh) * Math.min(deltaTime * 4, 1);
      this.cupLiquidMaterial.uniforms.slosh.value = this.cupSlosh;
    }

    this.syncWindAudio();

    if (this.reducedMotion) {
      this.roofGroup.position.y = this.roofTargetY;
      if (this.steeringWheelGroup) {
        this.steeringWheelGroup.rotation.z = this.steeringAngle;
      }
      if (this.isWiperActive && this.quality !== 'low') {
        this.wiperLeft && (this.wiperLeft.rotation.z = -Math.PI / 6);
        this.wiperRight && (this.wiperRight.rotation.z = Math.PI / 6);
      }
      if (this.quality !== 'low') this.updateGaugles();
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

    if (this.isWiperActive && this.quality !== 'low') {
      this.wiperAnimationTime += clampedDelta;
      const wiperCycle = this.wiperAnimationTime % 1.0;
      const wiperAngle = Math.sin(wiperCycle * Math.PI) * (Math.PI / 4);
      if (this.wiperLeft) this.wiperLeft.rotation.z = -wiperAngle - Math.PI / 6;
      if (this.wiperRight) this.wiperRight.rotation.z = wiperAngle + Math.PI / 6;
    }

    if (this.quality !== 'low') this.updateGaugles();
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

  private updateGaugles(): void {
    CarInteriorGauges.updateGaugeNeedles(
      this.speedometerNeedle,
      this.tachometerNeedle,
      this.speedometer,
      this.tachometer
    );
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
      if (this.wiperLeft) this.wiperLeft.rotation.z = -Math.PI / 6;
      if (this.wiperRight) this.wiperRight.rotation.z = Math.PI / 6;
    }
  }

  public setGaugeValues(speed: number, rpm: number): void {
    this.speedometer = Math.max(0, Math.min(100, speed));
    this.tachometer = Math.max(0, Math.min(8000, rpm));
  }

  public setRoofTargetY(y: number): void {
    this.roofTargetY = y;
  }
}
