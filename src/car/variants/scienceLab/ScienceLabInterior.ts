import * as THREE from 'three';
import { ScienceLabAudio } from './scienceLabAudio';
import {
    buildLabInterior,
    createScienceLabLighting,
    type ScienceLabGeometryContext,
} from './scienceLabGeometry';
import { createScienceLabMaterials, type ScienceLabMaterials } from './scienceLabMaterials';
import { applyLabInstrumentOverlay } from './instrumentWidgets';

/**
 * LabState - State tracking for the science lab vehicle
 */
export interface LabState {
    equipmentActive: boolean;
    sampleCount: number;
    dataLogging: boolean;
    uvLightEnabled: boolean;
    instrumentReadings: {
        spectrometer: number;
        phMeter: number;
        temperature: number;
        radiation: number;
    };
}

/**
 * ScienceLabInterior - Mobile research laboratory interior
 * Completely different layout from standard sedan:
 * - Equipment racks instead of passenger seat
 * - Scientific instrument displays
 * - Side-facing bench seats
 * - Lab equipment sounds (fans, beeps)
 * - Special lighting (UV option)
 */
export class ScienceLabInterior {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public canvas: HTMLCanvasElement;

    private labGroup: THREE.Group;
    private equipmentGroup: THREE.Group;
    private instrumentDisplays: THREE.Mesh[] = [];
    private displayMaterials: THREE.MeshStandardMaterial[] = [];
    private uvLight!: THREE.PointLight;
    private equipmentFans: THREE.Group[] = [];
    private sampleDrawers: THREE.Group[] = [];

    // Animation state
    private animationId: number = 0;
    private fanRotationSpeed: number = 5;
    private blinkTime: number = 0;

    // Lab state
    private labState: LabState = {
        equipmentActive: true,
        sampleCount: 12,
        dataLogging: true,
        uvLightEnabled: false,
        instrumentReadings: {
            spectrometer: 450,
            phMeter: 7.2,
            temperature: 22.5,
            radiation: 0.03
        }
    };

    private audio = new ScienceLabAudio();
    private materials!: ScienceLabMaterials;

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.01, 100);
        this.camera.position.set(-0.3, 1.25, 0.0);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.autoClear = false;
        this.canvas = this.renderer.domElement;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '100';
        this.canvas.style.display = 'block';
        this.canvas.style.visibility = 'visible';
        container.appendChild(this.canvas);

        this.labGroup = new THREE.Group();
        this.equipmentGroup = new THREE.Group();
        this.scene.add(this.labGroup);
        this.scene.add(this.equipmentGroup);

        this.materials = createScienceLabMaterials();
        const lighting = createScienceLabLighting(this.scene);
        this.uvLight = lighting.uvLight;
        void lighting.taskLights;
        buildLabInterior(this.createGeometryContext());
        this.audio.init();
    }

    private createGeometryContext(): ScienceLabGeometryContext {
        return {
            labGroup: this.labGroup,
            equipmentGroup: this.equipmentGroup,
            materials: this.materials,
            instrumentDisplays: this.instrumentDisplays,
            displayMaterials: this.displayMaterials,
            equipmentFans: this.equipmentFans,
            sampleDrawers: this.sampleDrawers,
        };
    }

    /**
     * Toggle UV light on/off
     */
    public toggleUVLight(): boolean {
        this.labState.uvLightEnabled = !this.labState.uvLightEnabled;
        this.uvLight.intensity = this.labState.uvLightEnabled ? 0.8 : 0;
        this.audio.playBeep(this.labState.uvLightEnabled ? 1200 : 600, 0.15);
        return this.labState.uvLightEnabled;
    }

    /**
     * Get current UV light state
     */
    public getUVLightState(): boolean {
        return this.labState.uvLightEnabled;
    }

    /**
     * Toggle equipment power
     */
    public toggleEquipment(): boolean {
        this.labState.equipmentActive = !this.labState.equipmentActive;
        this.fanRotationSpeed = this.labState.equipmentActive ? 5 : 0;

        this.audio.setFanGain(this.labState.equipmentActive);

        this.displayMaterials.forEach(mat => {
            mat.emissiveIntensity = this.labState.equipmentActive ? 0.3 : 0.05;
        });

        this.audio.playBeep(this.labState.equipmentActive ? 1000 : 500, 0.2);
        return this.labState.equipmentActive;
    }

    /**
     * Get equipment state
     */
    public getEquipmentState(): LabState {
        return { ...this.labState };
    }

    /**
     * Update lab readings
     */
    public updateReadings(readings: Partial<LabState['instrumentReadings']>): void {
        Object.assign(this.labState.instrumentReadings, readings);
    }

    /**
     * Update loop - animate equipment
     */
    public update(deltaTime: number): void {
        this.blinkTime += deltaTime;

        this.equipmentFans.forEach((fan, index) => {
            if (this.labState.equipmentActive) {
                fan.children.forEach((child, childIndex) => {
                    if (childIndex > 0) {
                        child.rotation.z += this.fanRotationSpeed * deltaTime * (index % 2 === 0 ? 1 : -1);
                    }
                });
            }
        });

        if (this.labState.equipmentActive && this.labState.dataLogging) {
            const blinkIntensity = 0.3 + Math.sin(this.blinkTime * 4) * 0.1;
            this.displayMaterials.forEach((mat, index) => {
                mat.emissiveIntensity = blinkIntensity + (index * 0.05);
            });
        }

        if (this.labState.equipmentActive && Math.random() < 0.001) {
            this.audio.playBeep(600 + Math.random() * 400, 0.05);
        }

        applyLabInstrumentOverlay(this.displayMaterials, {
            speedKmh: this.labState.instrumentReadings.spectrometer,
            sunAltitude: this.labState.instrumentReadings.temperature / 40,
        });
    }

    /**
     * Set the lab vehicle orientation
     */
    public setCarOrientation(carHeading: number, bodyPitch: number = 0, bodyRoll: number = 0): void {
        const yawRad = -THREE.MathUtils.degToRad(carHeading);
        const pitchRad = THREE.MathUtils.degToRad(bodyPitch);
        const rollRad = THREE.MathUtils.degToRad(bodyRoll);
        this.labGroup.rotation.set(pitchRad, yawRad, rollRad);
        this.equipmentGroup.rotation.set(pitchRad, yawRad, rollRad);
    }

    /**
     * Set the head/camera orientation
     */
    public setHeadOrientation(headYaw: number, headPitch: number): void {
        const clampedYaw = Math.max(-110, Math.min(110, headYaw));
        const clampedPitch = Math.max(-45, Math.min(65, headPitch));

        const yawRad = THREE.MathUtils.degToRad(clampedYaw);
        const pitchRad = THREE.MathUtils.degToRad(clampedPitch);

        this.camera.rotation.set(-pitchRad, yawRad, 0);
    }

    /**
     * Render the lab interior
     */
    public render(): void {
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Handle window resize
     */
    public resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        cancelAnimationFrame(this.animationId);
        this.audio.dispose();

        this.renderer.dispose();
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });

        if (this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
    }
}
