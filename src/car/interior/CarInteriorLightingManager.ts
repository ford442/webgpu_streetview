import * as THREE from 'three';
import { setCabinGlowState } from './MaterialFactory';

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
        private dashboardMaterial: THREE.MeshStandardMaterial | undefined,
        private leatherMaterial: THREE.MeshStandardMaterial | undefined,
        private frameMaterial: THREE.MeshStandardMaterial | undefined,
        private windshieldGlassMesh: THREE.Mesh | null,
        private rearGlassMesh: THREE.Mesh | null,
        private sunLight?: THREE.DirectionalLight
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

    // Sun colour ramp: warm at the horizon (golden hour) → neutral at midday.
    private static readonly SUN_WARM = new THREE.Color(0xffab5e);
    private static readonly SUN_NEUTRAL = new THREE.Color(0xfff4e6);
    // Ambient sky tint: cool blue at night, golden at the horizon, warm-neutral midday.
    private static readonly SKY_NIGHT = new THREE.Color(0x3a4a72);
    private static readonly SKY_GOLDEN = new THREE.Color(0xffc78f);
    private static readonly SKY_DAY = new THREE.Color(0xfff5e0);

    /**
     * Drive the sun directional light and ambient tint from the real sun.
     * @param azimuth  - SunCalc azimuth in radians (0 = south, positive west)
     * @param altitude - SunCalc altitude in radians (0 = horizon)
     */
    public setSunState(azimuth: number, altitude: number): void {
        const sinAlt = Math.sin(altitude);
        // Below the horizon → night; fully night by -12° (nautical twilight).
        this.sunNightFactor = altitude <= 0
            ? Math.min(1, -altitude / 0.21)
            : 0;

        if (this.sunLight) {
            // SunCalc azimuth is measured from south; compass heading H maps
            // to world direction (sin H, 0, -cos H) in this scene's frame.
            const heading = azimuth + Math.PI;
            const cosAlt = Math.cos(altitude);
            this.sunLight.position.set(
                Math.sin(heading) * cosAlt * 20,
                sinAlt * 20,
                -Math.cos(heading) * cosAlt * 20
            );
            this.sunLight.target.position.set(0, 0, 0);

            // Ramp up over the first ~14° of altitude; off below the horizon.
            const strength = Math.max(0, Math.min(1, sinAlt / 0.25));
            this.sunBaseIntensity = strength * 1.1;
            this.sunLight.color
                .copy(CarInteriorLightingManager.SUN_WARM)
                .lerp(CarInteriorLightingManager.SUN_NEUTRAL, strength);
        }

        // Ambient tint by altitude: goldenness peaks at the horizon and fades
        // out by ±20°, blended toward cool blue as night falls.
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
            this.headlightsLight.intensity = this.headlightsLight.intensity > 0 ? 0 : 0.5;
        }
    }

    public getHeadlightsState(): boolean {
        return this.headlightsLight ? this.headlightsLight.intensity > 0 : false;
    }

    public setHeadlights(on: boolean): void {
        if (this.headlightsLight) {
            this.headlightsLight.intensity = on ? 0.5 : 0;
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
        // Whichever says it's darker wins: the user/preset nightIntensity or
        // the real sun's altitude at the pano's location.
        const effectiveNight = Math.max(nightIntensity, this.sunNightFactor);
        const dayFactor = 1 - effectiveNight;
        // Rain reads as overcast: direct sun collapses, diffuse light dims a
        // little but survives (clouds scatter rather than block).
        const rain = this.weatherIntensity;
        const direct = 1 - rain * 0.75;
        const diffuse = 1 - rain * 0.3;
        // Living-cabin breathing: a ±2% swell on the ambient terms, slow
        // enough to be felt rather than seen.
        const breathe = this.reducedMotion
            ? 0
            : Math.sin(performance.now() * 0.0006) * 0.02;

        if (this.sunLight) {
            const sunTarget = this.sunBaseIntensity * direct;
            this.sunLight.intensity += (sunTarget - this.sunLight.intensity) * 0.05;
        }
        if (this.hemisphereLight) {
            const hemiTarget = (0.38 * dayFactor + 0.05) * diffuse * (1 + breathe);
            this.hemisphereLight.intensity += (hemiTarget - this.hemisphereLight.intensity) * 0.05;
        }
        if (this.ambientLight) {
            const ambTarget = (0.11 * dayFactor + 0.02) * diffuse * (1 + breathe);
            this.ambientLight.intensity += (ambTarget - this.ambientLight.intensity) * 0.05;
        }
        if (this.overheadLight) {
            const overTarget = 0.55 * dayFactor * direct;
            this.overheadLight.intensity += (overTarget - this.overheadLight.intensity) * 0.05;
        }
        if (this.leftWindowLight) {
            const leftTarget = (0.28 * dayFactor + 0.03) * diffuse;
            this.leftWindowLight.intensity += (leftTarget - this.leftWindowLight.intensity) * 0.05;
        }
        if (this.rightWindowLight) {
            const rightTarget = (0.18 * dayFactor + 0.02) * diffuse;
            this.rightWindowLight.intensity += (rightTarget - this.rightWindowLight.intensity) * 0.05;
        }

        // Accent strips + button backlights: one call scales every registered
        // emissive material for the current cabin state.
        setCabinGlowState(effectiveNight, headlightsOn, breathe);

        const matBrightness = 0.6 + dayFactor * 0.4;
        if (this.dashboardMaterial) {
            this.dashboardMaterial.color.setScalar(matBrightness);
        }
        if (this.leatherMaterial) {
            this.leatherMaterial.color.setScalar(matBrightness);
        }
        if (this.frameMaterial) {
            this.frameMaterial.color.setScalar(matBrightness);
        }

        const bounceTarget = headlightsOn ? effectiveNight * 0.35 : 0;
        if (this.interiorBounceLight) {
            this.interiorBounceLight.intensity += (bounceTarget - this.interiorBounceLight.intensity) * 0.08;
        }

        // Dash panels self-glow after dark (gauge backlights), with an extra
        // bump when the headlights are on.
        if (this.instrumentClusterMat) {
            const target = 0.5 + effectiveNight * 0.8 + (headlightsOn ? 0.2 : 0);
            this.instrumentClusterMat.emissiveIntensity += (target - this.instrumentClusterMat.emissiveIntensity) * 0.08;
        }
        if (this.centerDisplayMat) {
            const target = 0.3 + effectiveNight * 0.6 + (headlightsOn ? 0.15 : 0);
            this.centerDisplayMat.emissiveIntensity += (target - this.centerDisplayMat.emissiveIntensity) * 0.08;
        }

        // Faint warm cabin glow at night even with the dome switch off.
        const domeTarget = (domeLightOn ? 1.2 : effectiveNight * 0.18) * (1 + breathe);
        if (this.domeLightSource) {
            this.domeLightSource.intensity += (domeTarget - this.domeLightSource.intensity) * 0.08;
        }

        if (this.domeLightFixtureMesh) {
            const fixMat = this.domeLightFixtureMesh.material as THREE.MeshStandardMaterial;
            fixMat.emissiveIntensity += ((domeLightOn ? 1.0 : 0) - fixMat.emissiveIntensity) * 0.08;
        }
        if (this.domeSwitchMesh) {
            const swMat = this.domeSwitchMesh.material as THREE.MeshStandardMaterial;
            swMat.emissiveIntensity = domeLightOn ? 0.6 : 0;
        }
        if (this.digitalClockMesh) {
            const clockMat = this.digitalClockMesh.material as THREE.MeshStandardMaterial;
            const clockTarget = domeLightOn ? 1.1 : 0.75 + effectiveNight * 0.4;
            clockMat.emissiveIntensity += (clockTarget - clockMat.emissiveIntensity) * 0.08;
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
}
