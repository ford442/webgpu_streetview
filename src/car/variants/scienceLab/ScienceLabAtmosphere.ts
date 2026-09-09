import * as THREE from 'three';
import type { VehicleType } from '../../VehicleManager';
import { ScienceLabAudio } from './scienceLabAudio';
import {
    buildEquipmentRack,
    buildInstrumentDisplays,
    buildSampleStorage,
    createScienceLabLighting,
    type ScienceLabGeometryContext,
} from './scienceLabGeometry';
import { createScienceLabMaterials, type ScienceLabMaterials } from './scienceLabMaterials';
import { applyLabInstrumentOverlay } from './instrumentWidgets';

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

const DEFAULT_LAB_STATE: LabState = {
    equipmentActive: true,
    sampleCount: 12,
    dataLogging: true,
    uvLightEnabled: false,
    instrumentReadings: {
        spectrometer: 450,
        phMeter: 7.2,
        temperature: 22.5,
        radiation: 0.03,
    },
};

/**
 * Science-lab equipment rack, sample storage and instrument overlay layered
 * onto the shared car-mode cabin, behind the front seats.
 *
 * Same pattern as `ConvertibleMode`: shares `interior.interiorGroup`, never
 * a second renderer. Ported from the orphan `ScienceLabInterior` (closed
 * #239/#236 follow-up), which used to render into its own private
 * `THREE.WebGLRenderer` that nothing on the live path ever called. Its
 * driver seat / floor / bench-seat / roof geometry is dropped here — the
 * shared `CarInteriorBuilder` already builds those for every vehicle type;
 * only the lab-specific equipment survives the fold.
 */
const ROOT_OFFSET_Z = 0.9;

export class ScienceLabAtmosphere {
    private root = new THREE.Group();
    private equipmentGroup = new THREE.Group();
    private labGroup = new THREE.Group();

    private materials: ScienceLabMaterials;
    private uvLight: THREE.PointLight;

    private instrumentDisplays: THREE.Mesh[] = [];
    private displayMaterials: THREE.MeshStandardMaterial[] = [];
    private equipmentFans: THREE.Group[] = [];
    private sampleDrawers: THREE.Group[] = [];

    private audio = new ScienceLabAudio();
    private state: LabState;
    private interiorGroup: THREE.Group;
    private fanRotationSpeed = 5;
    private blinkTime = 0;

    constructor(
        interiorGroup: THREE.Group,
        initialState: Partial<LabState> = {},
    ) {
        this.interiorGroup = interiorGroup;
        this.state = { ...DEFAULT_LAB_STATE, ...initialState };

        this.root.name = 'scienceLabAtmosphere';
        this.root.position.set(0, 0, ROOT_OFFSET_Z);
        this.root.add(this.equipmentGroup, this.labGroup);

        this.materials = createScienceLabMaterials();
        const lighting = createScienceLabLighting(this.root);
        this.uvLight = lighting.uvLight;

        const ctx = this.createGeometryContext();
        buildEquipmentRack(ctx);
        buildInstrumentDisplays(ctx);
        buildSampleStorage(ctx);

        this.attachToCabin();
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
     * Re-parent onto the shared cabin group. `interiorGroup.clear()` (see
     * `rebuildCarInteriorForVehicle`) only detaches children — it doesn't
     * dispose them — so this plugin's own groups survive a vehicle-switch
     * rebuild and just need to be re-added.
     */
    attachToCabin(): void {
        this.interiorGroup.add(this.root);
    }

    setVehicleType(type: VehicleType): void {
        this.root.visible = type === 'science-lab';
    }

    toggleUVLight(): boolean {
        this.state.uvLightEnabled = !this.state.uvLightEnabled;
        this.uvLight.intensity = this.state.uvLightEnabled ? 0.8 : 0;
        this.audio.playBeep(this.state.uvLightEnabled ? 1200 : 600, 0.15);
        return this.state.uvLightEnabled;
    }

    toggleEquipment(): boolean {
        this.state.equipmentActive = !this.state.equipmentActive;
        this.fanRotationSpeed = this.state.equipmentActive ? 5 : 0;
        this.audio.setFanGain(this.state.equipmentActive);
        this.displayMaterials.forEach((mat) => {
            mat.emissiveIntensity = this.state.equipmentActive ? 0.3 : 0.05;
        });
        this.audio.playBeep(this.state.equipmentActive ? 1000 : 500, 0.2);
        return this.state.equipmentActive;
    }

    getState(): LabState {
        return { ...this.state };
    }

    updateReadings(readings: Partial<LabState['instrumentReadings']>): void {
        Object.assign(this.state.instrumentReadings, readings);
    }

    update(deltaTime: number): void {
        this.blinkTime += deltaTime;

        this.equipmentFans.forEach((fan, index) => {
            if (this.state.equipmentActive) {
                fan.children.forEach((child, childIndex) => {
                    if (childIndex > 0) {
                        child.rotation.z += this.fanRotationSpeed * deltaTime * (index % 2 === 0 ? 1 : -1);
                    }
                });
            }
        });

        if (this.state.equipmentActive && this.state.dataLogging) {
            const blinkIntensity = 0.3 + Math.sin(this.blinkTime * 4) * 0.1;
            this.displayMaterials.forEach((mat, index) => {
                mat.emissiveIntensity = blinkIntensity + index * 0.05;
            });
        }

        if (this.state.equipmentActive && Math.random() < 0.001) {
            this.audio.playBeep(600 + Math.random() * 400, 0.05);
        }

        applyLabInstrumentOverlay(this.displayMaterials, {
            speedKmh: this.state.instrumentReadings.spectrometer,
            sunAltitude: this.state.instrumentReadings.temperature / 40,
        });
    }

    dispose(): void {
        this.audio.dispose();
        this.root.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        this.root.removeFromParent();
    }
}

export default ScienceLabAtmosphere;
