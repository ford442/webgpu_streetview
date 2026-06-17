import * as THREE from 'three';

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
        private rearGlassMesh: THREE.Mesh | null
    ) {}

    private isDomeLightOn: boolean = false;

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
        const dayFactor = 1 - nightIntensity;
        if (this.hemisphereLight) {
            const hemiTarget = 0.38 * dayFactor + 0.05;
            this.hemisphereLight.intensity += (hemiTarget - this.hemisphereLight.intensity) * 0.05;
        }
        if (this.ambientLight) {
            const ambTarget = 0.11 * dayFactor + 0.02;
            this.ambientLight.intensity += (ambTarget - this.ambientLight.intensity) * 0.05;
        }
        if (this.overheadLight) {
            const overTarget = 0.55 * dayFactor;
            this.overheadLight.intensity += (overTarget - this.overheadLight.intensity) * 0.05;
        }
        if (this.leftWindowLight) {
            const leftTarget = 0.28 * dayFactor + 0.03;
            this.leftWindowLight.intensity += (leftTarget - this.leftWindowLight.intensity) * 0.05;
        }
        if (this.rightWindowLight) {
            const rightTarget = 0.18 * dayFactor + 0.02;
            this.rightWindowLight.intensity += (rightTarget - this.rightWindowLight.intensity) * 0.05;
        }

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

        const bounceTarget = headlightsOn ? nightIntensity * 0.35 : 0;
        if (this.interiorBounceLight) {
            this.interiorBounceLight.intensity += (bounceTarget - this.interiorBounceLight.intensity) * 0.08;
        }

        if (this.instrumentClusterMat) {
            const target = headlightsOn ? 0.5 + nightIntensity * 0.8 : 0.5;
            this.instrumentClusterMat.emissiveIntensity += (target - this.instrumentClusterMat.emissiveIntensity) * 0.08;
        }
        if (this.centerDisplayMat) {
            const target = headlightsOn ? 0.3 + nightIntensity * 0.6 : 0.3;
            this.centerDisplayMat.emissiveIntensity += (target - this.centerDisplayMat.emissiveIntensity) * 0.08;
        }

        const domeTarget = domeLightOn ? 1.2 : 0;
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
            const clockTarget = domeLightOn ? 1.1 : 0.75 + nightIntensity * 0.4;
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
