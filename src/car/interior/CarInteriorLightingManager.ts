import * as THREE from 'three';
import { setCabinGlowState } from './MaterialFactory';
import { setCabinGlowLevel, type CabinGlowSprite } from './CabinEmitterGlow';
import {
    cabinEmitterTargets,
    cabinFillTargets,
    clusterGlowLevel,
    domeGlowLevel,
    iblIntensityFromNight,
    sunBaseIntensityFromStrength,
    sunNightFactorFromAltitude,
    sunStrengthFromAltitude,
} from './cabinLightingRamps';

export class CarInteriorLightingManager {
    constructor(
        private headlightsLight: THREE.SpotLight | undefined,
        private domeLightSource: THREE.PointLight | undefined,
        private domeLightFixtureMesh: THREE.Mesh | null,
        private domeSwitchMesh: THREE.Mesh | null,
        private digitalClockMesh: THREE.Mesh | null,
        private instrumentClusterMat: THREE.MeshStandardMaterial | null,
        private centerDisplayMat: THREE.MeshStandardMaterial | null,
        private hemisphereLight: THREE.HemisphereLight | undefined,
        private ambientLight: THREE.AmbientLight | undefined,
        private overheadLight: THREE.DirectionalLight | undefined,
        private leftWindowLight: THREE.PointLight | undefined,
        private rightWindowLight: THREE.PointLight | undefined,
        private interiorBounceLight: THREE.PointLight | undefined,
        private windshieldGlassMesh: THREE.Mesh | null,
        private rearGlassMesh: THREE.Mesh | null,
        private sunLight?: THREE.DirectionalLight,
        private dashLight?: THREE.PointLight,
        private clinical: boolean = false,
    ) {}

    private isDomeLightOn: boolean = false;
    /** 0 = sun up, 1 = full night; derived from real sun altitude. */
    private sunNightFactor: number = 0;
    /** 0-1 rain intensity: overcast skies dim and diffuse the daylight. */
    private weatherIntensity: number = 0;
    /** Sun intensity before weather attenuation (set with the sun state). */
    private sunBaseIntensity: number = 0;
    /** Disables the ambient breathing modulation. */
    private reducedMotion: boolean = false;
    private emitterGlows: CabinGlowSprite[] = [];
    private lastNightIntensity: number = 0;

    // Sun colour ramp: warm at the horizon (golden hour) → neutral at midday.
    private static readonly SUN_WARM = new THREE.Color(0xffab5e);
    private static readonly SUN_NEUTRAL = new THREE.Color(0xfff4e6);
    // Ambient sky tint: cool blue at night, golden at the horizon, warm-neutral midday.
    private static readonly SKY_NIGHT = new THREE.Color(0x3a4a72);
    private static readonly SKY_GOLDEN = new THREE.Color(0xffc78f);
    private static readonly SKY_DAY = new THREE.Color(0xfff5e0);

    public rebindCabin(opts: {
        domeLightFixtureMesh: THREE.Mesh | null;
        domeSwitchMesh: THREE.Mesh | null;
        digitalClockMesh: THREE.Mesh | null;
        instrumentClusterMat: THREE.MeshStandardMaterial | null;
        centerDisplayMat: THREE.MeshStandardMaterial | null;
        dashboardMaterial?: THREE.MeshStandardMaterial;
        leatherMaterial?: THREE.MeshStandardMaterial;
        frameMaterial?: THREE.MeshStandardMaterial;
        windshieldGlassMesh?: THREE.Mesh | null;
        rearGlassMesh?: THREE.Mesh | null;
        clinical?: boolean;
        emitterGlows?: CabinGlowSprite[];
        dashLightColor?: number;
    }): void {
        this.domeLightFixtureMesh = opts.domeLightFixtureMesh;
        this.domeSwitchMesh = opts.domeSwitchMesh;
        this.digitalClockMesh = opts.digitalClockMesh;
        this.instrumentClusterMat = opts.instrumentClusterMat;
        this.centerDisplayMat = opts.centerDisplayMat;
        if (opts.windshieldGlassMesh !== undefined) this.windshieldGlassMesh = opts.windshieldGlassMesh;
        if (opts.rearGlassMesh !== undefined) this.rearGlassMesh = opts.rearGlassMesh;
        if (opts.clinical !== undefined) this.clinical = opts.clinical;
        if (opts.emitterGlows) this.emitterGlows = opts.emitterGlows;
        if (opts.dashLightColor !== undefined && this.dashLight) {
            this.dashLight.color.setHex(opts.dashLightColor);
        }
    }

    public setEmitterGlows(glows: CabinGlowSprite[]): void {
        this.emitterGlows = glows;
    }

    /** Re-parent cabin-space lights after `interiorGroup.clear()` on vehicle swap. */
    public attachCabinLights(interiorGroup: THREE.Group): void {
        const add = (obj: THREE.Object3D | undefined) => {
            if (obj && obj.parent !== interiorGroup) interiorGroup.add(obj);
        };
        add(this.dashLight);
        add(this.domeLightSource);
        add(this.headlightsLight);
        if (this.headlightsLight) add(this.headlightsLight.target);
        add(this.interiorBounceLight);
        add(this.overheadLight);
        add(this.leftWindowLight);
        add(this.rightWindowLight);
    }

    /**
     * Drive the sun directional light and ambient tint from the real sun.
     * @param azimuth  - SunCalc azimuth in radians (0 = south, positive west)
     * @param altitude - SunCalc altitude in radians (0 = horizon)
     */
    public setSunState(azimuth: number, altitude: number): void {
        this.sunNightFactor = sunNightFactorFromAltitude(altitude);

        if (this.sunLight) {
            const heading = azimuth + Math.PI;
            const cosAlt = Math.cos(altitude);
            const sinAlt = Math.sin(altitude);
            this.sunLight.position.set(
                Math.sin(heading) * cosAlt * 20,
                sinAlt * 20,
                -Math.cos(heading) * cosAlt * 20
            );
            this.sunLight.target.position.set(0, 0, 0);

            const strength = sunStrengthFromAltitude(altitude);
            this.sunBaseIntensity = sunBaseIntensityFromStrength(strength);
            this.sunLight.color
                .copy(CarInteriorLightingManager.SUN_WARM)
                .lerp(CarInteriorLightingManager.SUN_NEUTRAL, strength);
        }

        const sinAlt = Math.sin(altitude);
        const goldenness = Math.max(0, 1 - Math.abs(sinAlt) / 0.35);
        const tint = new THREE.Color()
            .copy(CarInteriorLightingManager.SKY_DAY)
            .lerp(CarInteriorLightingManager.SKY_GOLDEN, goldenness)
            .lerp(CarInteriorLightingManager.SKY_NIGHT, this.sunNightFactor);
        this.hemisphereLight?.color.copy(tint);
        this.overheadLight?.color.copy(tint);
        this.leftWindowLight?.color.copy(tint);
        this.rightWindowLight?.color.copy(tint);
    }

    /** Night factor (0-1) derived from the last reported sun altitude. */
    public getSunNightFactor(): number {
        return this.sunNightFactor;
    }

    public getEffectiveNight(nightIntensity: number = this.lastNightIntensity): number {
        return Math.max(nightIntensity, this.sunNightFactor);
    }

    public getIblIntensity(nightIntensity?: number): number {
        return iblIntensityFromNight(this.getEffectiveNight(nightIntensity));
    }

    /** 0-1 rain intensity; dims the sun and diffuses window light. */
    public setWeatherIntensity(rain: number): void {
        this.weatherIntensity = Math.max(0, Math.min(1, rain));
    }

    public getWeatherIntensity(): number {
        return this.weatherIntensity;
    }

    public setReducedMotion(reduced: boolean): void {
        this.reducedMotion = reduced;
    }

    public toggleHeadlights(): void {
        if (this.headlightsLight) {
            this.headlightsLight.intensity = this.headlightsLight.intensity > 0 ? 0 : 0.2;
        }
    }

    public getHeadlightsState(): boolean {
        return this.headlightsLight ? this.headlightsLight.intensity > 0 : false;
    }

    public setHeadlights(on: boolean): void {
        if (this.headlightsLight) {
            this.headlightsLight.intensity = on ? 0.2 : 0;
        }
    }

    public toggleDomeLight(): boolean {
        this.isDomeLightOn = !this.isDomeLightOn;
        return this.isDomeLightOn;
    }

    public getDomeLightState(): boolean {
        return this.isDomeLightOn;
    }

    public setDomeLight(on: boolean): void {
        this.isDomeLightOn = on;
    }

    public setInteriorLighting(headlightsOn: boolean, nightIntensity: number, domeLightOn: boolean): void {
        this.lastNightIntensity = nightIntensity;
        const effectiveNight = this.getEffectiveNight(nightIntensity);
        const rain = this.weatherIntensity;
        const breathe = this.reducedMotion
            ? 0
            : Math.sin(performance.now() * 0.0006) * 0.02;

        const rampIn = {
            effectiveNight,
            rain,
            headlightsOn,
            domeLightOn,
            clinical: this.clinical,
        };
        const fill = cabinFillTargets(rampIn);
        const emit = cabinEmitterTargets(rampIn);

        if (this.sunLight) {
            const sunTarget = this.sunBaseIntensity * (1 - rain * 0.75);
            this.sunLight.intensity += (sunTarget - this.sunLight.intensity) * 0.05;
        }
        this.lerpIntensity(this.hemisphereLight, fill.hemi * (1 + breathe));
        this.lerpIntensity(this.ambientLight, fill.ambient * (1 + breathe));
        this.lerpIntensity(this.overheadLight, fill.overhead);
        this.lerpIntensity(this.leftWindowLight, fill.leftWindow);
        this.lerpIntensity(this.rightWindowLight, fill.rightWindow);
        this.lerpIntensity(this.interiorBounceLight, fill.bounce);
        this.lerpIntensity(this.dashLight, fill.dash);
        this.lerpIntensity(this.domeLightSource, fill.dome * (1 + breathe));
        this.lerpIntensity(this.headlightsLight, fill.headlights);

        setCabinGlowState(effectiveNight, headlightsOn, breathe);

        this.lerpEmissive(this.instrumentClusterMat, emit.cluster);
        this.lerpEmissive(this.centerDisplayMat, emit.centerDisplay);

        if (this.domeLightFixtureMesh) {
            this.lerpEmissive(
                this.domeLightFixtureMesh.material as THREE.MeshStandardMaterial,
                emit.domeFixture,
            );
        }
        if (this.domeSwitchMesh) {
            const swMat = this.domeSwitchMesh.material as THREE.MeshStandardMaterial;
            swMat.emissiveIntensity = emit.domeSwitch;
        }
        if (this.digitalClockMesh) {
            this.lerpEmissive(
                this.digitalClockMesh.material as THREE.MeshStandardMaterial,
                emit.clock,
            );
        }

        const t = performance.now() * 0.001;
        for (const glow of this.emitterGlows) {
            const level = glow.kind === 'dome'
                ? domeGlowLevel(rampIn)
                : clusterGlowLevel(rampIn);
            setCabinGlowLevel(glow, level, t, this.reducedMotion);
        }
    }

    public updateWindowTint(val: number): void {
        const clamped = Math.max(0, Math.min(1, val));
        const darkness = 0.1 + clamped * 0.7;
        const opacity = 0.08 + clamped * 0.62;

        if (this.windshieldGlassMesh?.material) {
            const mat = this.windshieldGlassMesh.material as THREE.MeshPhysicalMaterial;
            mat.color.set(new THREE.Color('#eef5f8')).multiplyScalar(1 - darkness * 0.5);
            mat.opacity = opacity;
        }
        if (this.rearGlassMesh?.material) {
            const mat = this.rearGlassMesh.material as THREE.MeshPhysicalMaterial;
            mat.color.set(new THREE.Color('#6a9aae')).multiplyScalar(1 - darkness * 0.5);
            mat.opacity = opacity;
        }
    }

    private lerpIntensity(
        light: { intensity: number } | undefined,
        target: number,
        rate = 0.05,
    ): void {
        if (!light) return;
        light.intensity += (target - light.intensity) * rate;
    }

    private lerpEmissive(
        mat: THREE.MeshStandardMaterial | null | undefined,
        target: number,
    ): void {
        if (!mat) return;
        mat.emissiveIntensity += (target - mat.emissiveIntensity) * 0.08;
    }
}
