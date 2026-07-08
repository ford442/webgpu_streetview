import * as THREE from 'three';
import { LODManager } from './LODManager';
import { RainSystem } from './RainSystem';
import {
    GaugeRig,
    needleAngle,
    SPEED_DIAL_MAX_KMH,
    TACHO_DIAL_MAX_RPM,
} from './CarInteriorGauges';

export class CarInteriorAnimator {
    constructor(
        private camera: THREE.PerspectiveCamera,
        private interiorGroup: THREE.Group,
        private roofGroup: THREE.Group,
        private steeringWheelGroup: THREE.Group | null,
        private wiperLeft: THREE.Group | null,
        private wiperRight: THREE.Group | null,
        private lodManager: LODManager,
        private rainSystem: RainSystem | undefined,
        private lodUpdateFn: (() => void) | undefined,
        private quality: 'high' | 'medium' | 'low',
        private reducedMotion: boolean
    ) {}

    private steeringAngle: number = 0;
    private isWiperActive: boolean = false;
    private wiperAnimationTime: number = 0;
    private isActive: boolean = true;
    private roofTargetY: number = 0;

    // Gauge state — needles run on a spring toward the target values so
    // they overshoot slightly on hard acceleration (needle bounce).
    private gaugeRig: GaugeRig | null = null;
    private targetSpeed: number = 0;
    private targetRpm: number = 0;
    private speedFrac: number = 0;
    private speedVel: number = 0;
    private rpmFrac: number = 0;
    private rpmVel: number = 0;
    private fuelLevel: number = 0.85;
    private tempFrac: number = 0.05;
    private gaugeClock: number = 0;
    private nightFactor: number = 0;

    public update(deltaTime: number): void {
        if (this.reducedMotion) {
            this.roofGroup.position.y = this.roofTargetY;
            if (this.steeringWheelGroup) {
                this.steeringWheelGroup.rotation.z = this.steeringAngle;
            }
            if (this.isWiperActive && this.quality !== 'low') {
                this.wiperLeft && (this.wiperLeft.rotation.z = -Math.PI / 6);
                this.wiperRight && (this.wiperRight.rotation.z = Math.PI / 6);
            }
            if (this.quality !== 'low') this.updateGauges(Math.min(deltaTime, 0.1));
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
            const diff = this.steeringAngle - this.steeringWheelGroup.rotation.z;
            let shortestDiff = diff;
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

        if (this.quality !== 'low') this.updateGauges(clampedDelta);
        if (this.lodUpdateFn) this.lodUpdateFn();
        this.lodManager.updateLOD(this.camera);
        if (this.rainSystem) this.rainSystem.update(deltaTime);
    }

    private updateGauges(dt: number): void {
        const rig = this.gaugeRig;
        if (!rig) return;

        this.gaugeClock += dt;
        const t = this.gaugeClock;
        const speedTargetFrac = this.targetSpeed / SPEED_DIAL_MAX_KMH;
        const rpmTargetFrac = this.targetRpm / TACHO_DIAL_MAX_RPM;

        if (this.reducedMotion) {
            // Direct, wobble-free tracking under prefers-reduced-motion.
            this.speedFrac = speedTargetFrac;
            this.rpmFrac = rpmTargetFrac;
            this.speedVel = this.rpmVel = 0;
            rig.speedNeedle.rotation.z = needleAngle(this.speedFrac);
            rig.tachoNeedle.rotation.z = needleAngle(this.rpmFrac);
        } else {
            // Underdamped springs: the speedo is heavy and slow, the tacho
            // snappy — both overshoot a touch on hard changes.
            this.speedVel += (-32 * (this.speedFrac - speedTargetFrac) - 7.0 * this.speedVel) * dt;
            this.speedFrac += this.speedVel * dt;
            this.rpmVel += (-90 * (this.rpmFrac - rpmTargetFrac) - 10.5 * this.rpmVel) * dt;
            this.rpmFrac += this.rpmVel * dt;

            // Road vibration grows with speed; engine buzz grows with RPM.
            const roadWobble =
                (Math.sin(t * 29.7) + Math.sin(t * 17.3) * 0.6) *
                0.0035 * Math.min(1, this.speedFrac * 2.5);
            const engineWobble = Math.sin(t * 47.1) * 0.004 * (0.2 + this.rpmFrac);
            rig.speedNeedle.rotation.z = needleAngle(this.speedFrac + roadWobble);
            rig.tachoNeedle.rotation.z = needleAngle(this.rpmFrac + engineWobble);
        }

        // Fuel burns with distance; coolant warms toward an operating point
        // set by load and slowly cools back down.
        const speedKmh = this.speedFrac * SPEED_DIAL_MAX_KMH;
        this.fuelLevel = Math.max(0.06, this.fuelLevel - speedKmh * dt * 1.4e-5);
        const tempTarget = speedKmh > 1 || this.rpmFrac > 0.15
            ? Math.min(0.8, 0.5 + this.rpmFrac * 0.35)
            : 0.05;
        const tempRate = tempTarget > this.tempFrac ? 0.05 : 0.015;
        this.tempFrac += (tempTarget - this.tempFrac) * Math.min(1, dt * tempRate * 10);

        if (rig.fuelNeedle) rig.fuelNeedle.rotation.z = needleAngle(this.fuelLevel);
        if (rig.tempNeedle) rig.tempNeedle.rotation.z = needleAngle(this.tempFrac);

        // Backlight: brighter at night, flares with revs, and breathes
        // gently like real cluster illumination.
        const breathe = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.6);
        const dialGlow = 0.22 + this.nightFactor * 0.55 + breathe * 0.05 + this.rpmFrac * 0.1;
        for (const mat of rig.dialMaterials) mat.emissiveIntensity = dialGlow;
        const needleGlow = 0.85 + this.nightFactor * 0.9 + breathe * 0.12 + this.rpmFrac * 0.4;
        for (const mat of rig.needleMaterials) mat.emissiveIntensity = needleGlow;
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

    /** Swap in the live gauge handles (called after every interior build). */
    public setGaugeRig(rig: GaugeRig | null): void {
        this.gaugeRig = rig;
    }

    /** 0-1 night intensity; drives gauge backlight brightness. */
    public setNightFactor(night: number): void {
        this.nightFactor = Math.max(0, Math.min(1, night));
    }

    public setGaugeValues(speed: number, rpm: number): void {
        this.targetSpeed = Math.max(0, Math.min(SPEED_DIAL_MAX_KMH, speed));
        this.targetRpm = Math.max(0, Math.min(TACHO_DIAL_MAX_RPM, rpm));
    }
}
