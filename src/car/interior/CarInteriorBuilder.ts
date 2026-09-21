import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import { CarInteriorDashboardBuilder } from './CarInteriorDashboardBuilder';
import { CarInteriorSeatBuilder } from './CarInteriorSeatBuilder';
import { CarInteriorSteeringBuilder } from './CarInteriorSteeringBuilder';
import { CarInteriorDoorBuilder } from './CarInteriorDoorBuilder';
import { CarInteriorShellBuilder } from './CarInteriorShellBuilder';
import { CarInteriorGlazingBuilder } from './CarInteriorGlazingBuilder';
import { CarInteriorMirrorBuilder } from './CarInteriorMirrorBuilder';
import { CarInteriorVariantBuilder } from './CarInteriorVariantBuilder';
import { type CabinGlowSprite } from './CabinEmitterGlow';

export interface CarInteriorMaterials {
    dashboard: THREE.MeshStandardMaterial;
    leather: THREE.MeshStandardMaterial;
    metal: THREE.MeshStandardMaterial;
    frame: THREE.MeshStandardMaterial;
    glass: THREE.MeshStandardMaterial;
    mirror: THREE.MeshStandardMaterial;
    accent: THREE.MeshStandardMaterial;
    chrome: THREE.MeshPhysicalMaterial;
}

export interface CarInteriorBuildResult {
    steeringWheelGroup: THREE.Group;
    wiperLeft: THREE.Group;
    wiperRight: THREE.Group;
    leftMirrorPlane: THREE.Mesh;
    rightMirrorPlane: THREE.Mesh;
    windshieldGlassMesh: THREE.Mesh;
    rearGlassMesh: THREE.Mesh;
    instrumentClusterMat: THREE.MeshStandardMaterial;
    centerDisplayMat: THREE.MeshStandardMaterial;
    domeLightFixtureMesh: THREE.Mesh;
    domeSwitchMesh: THREE.Mesh;
    glowSprites: CabinGlowSprite[];
    /**
     * Auxiliary screen materials (science-lab monitors, Cortianics center HUD).
     * Driven on the center-display ramp: readable by day, brightest at night.
     */
    auxDisplayMats: THREE.MeshStandardMaterial[];
    /** Wiper stalk lever (absent on vehicles without a steering wheel). */
    wiperStalkMesh?: THREE.Mesh;
    wiperStalkPivot?: THREE.Group;
}

/**
 * Orchestrator for the car interior. Owns **no geometry** — every `build*`
 * lives in a sibling `CarInterior*Builder`, and `buildAll()` only decides which
 * ones run, in what order, and how their handles merge into one result.
 *
 * | Builder | Owns |
 * |---|---|
 * | `CarInteriorDashboardBuilder` | dash, gauges, center display |
 * | `CarInteriorSteeringBuilder` | wheel, column, wiper stalk |
 * | `CarInteriorDoorBuilder` | door cards, armrests, console, switch batch |
 * | `CarInteriorSeatBuilder` | seats |
 * | `CarInteriorShellBuilder` | floor, mats, roof, dome light |
 * | `CarInteriorGlazingBuilder` | windshield, rear window, wipers |
 * | `CarInteriorMirrorBuilder` | side mirrors |
 * | `CarInteriorVariantBuilder` | per-vehicle extras (scene plugins) |
 *
 * **Order matters.** `glowSprites` is consumed in list order by the lighting
 * manager, so dashboard sprites come first, variant sprites next, and the dome
 * sprite last. Keep the call sequence below as it stands unless you mean to
 * change that.
 */
export class CarInteriorBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private roofGroup: THREE.Group,
        private vehicleConfig: VehicleConfig,
        private quality: 'high' | 'medium' | 'low',
        private geometryFactory: GeometryFactory,
        private lodManager: LODManager,
        private materials: CarInteriorMaterials,
        private reducedMotion: boolean = false,
    ) {}

    public buildAll(): CarInteriorBuildResult {
        const result: Partial<CarInteriorBuildResult> = {};
        const glowSprites: CabinGlowSprite[] = [];

        if (this.vehicleConfig.hasDashboard) {
            const dashboard = new CarInteriorDashboardBuilder(
                this.interiorGroup,
                this.materials,
                this.vehicleConfig,
                this.quality,
                this.geometryFactory,
                this.lodManager,
                this.reducedMotion,
            ).build();
            result.instrumentClusterMat = dashboard.instrumentClusterMat;
            result.centerDisplayMat = dashboard.centerDisplayMat;
            glowSprites.push(...dashboard.glowSprites);
        }

        if (this.vehicleConfig.hasSteeringWheel) {
            Object.assign(result, new CarInteriorSteeringBuilder(
                this.interiorGroup,
                this.materials,
                this.vehicleConfig,
            ).build());
        }

        new CarInteriorDoorBuilder(
            this.interiorGroup,
            this.materials,
            this.quality,
            this.geometryFactory,
            this.lodManager,
        ).build();

        new CarInteriorSeatBuilder(
            this.interiorGroup,
            this.materials,
            this.vehicleConfig,
            this.quality,
            this.geometryFactory,
        ).build();

        const shell = new CarInteriorShellBuilder(
            this.interiorGroup,
            this.roofGroup,
            this.vehicleConfig,
            this.quality,
            this.reducedMotion,
        );
        shell.buildCabin();

        const glazing = new CarInteriorGlazingBuilder(
            this.interiorGroup,
            this.materials,
            this.quality,
        );
        Object.assign(result, glazing.build());

        if (this.vehicleConfig.hasSideMirrors) {
            Object.assign(result, new CarInteriorMirrorBuilder(
                this.interiorGroup,
                this.materials,
            ).build());
        }

        if (this.vehicleConfig.hasWipers) {
            Object.assign(result, glazing.buildWipers());
        }

        const variant = new CarInteriorVariantBuilder(
            this.interiorGroup,
            this.materials,
            this.vehicleConfig,
            this.quality,
            this.reducedMotion,
        ).build();
        glowSprites.push(...variant.glowSprites);

        const dome = shell.buildDomeLight();
        result.domeLightFixtureMesh = dome.domeLightFixtureMesh;
        result.domeSwitchMesh = dome.domeSwitchMesh;
        glowSprites.push(...dome.glowSprites);

        result.glowSprites = glowSprites;
        result.auxDisplayMats = variant.auxDisplayMats;

        return result as CarInteriorBuildResult;
    }
}
