import * as THREE from 'three';
import {
    setupVehicleInteriorLOD,
    VehicleLODConfig,
    FrustumCuller,
} from '../../utils/performance';
import { VehicleType, VehicleConfig, getVehicleConfig } from '../VehicleManager';
import { resolveCameraFov } from '../vehicleLayout';
import { CarInteriorBuilder } from './CarInteriorBuilder';
import { CarInteriorGauges } from './CarInteriorGauges';
import { LocationPanel } from './LocationPanel';
import { CarInteriorDetailProps } from './CarInteriorDetailProps';
import { WindowWeatherOverlay } from './WindowWeatherOverlay';
import { SunShafts } from './SunShafts';
import { CenterDisplay } from './CenterDisplay';
import { VanityMirror } from './VanityMirror';
import { createMaterials, resetGlowRegistry } from './MaterialFactory';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import { RainSystem } from './RainSystem';
import { DustMoteSystem } from './DustMoteSystem';
import { InteriorMicroInteractions } from './InteriorMicroInteractions';
import { CarInteriorAnimator } from './CarInteriorAnimator';
import { CarInteriorRenderer } from './CarInteriorRenderer';
import { CarInteriorLightingManager } from './CarInteriorLightingManager';
import type { GaugeRig } from './CarInteriorGauges';
import type { CabinLeverCallbacks } from './CarInteriorDetailProps';
import type { CabinGlowSprite } from './CabinEmitterGlow';
import {
    applyGltfInterior,
    isGltfInteriorEnabled,
    loadGltfInteriorKit,
} from '../gltfInteriorKit';

/** Mutable assembly surface used by CarInterior during build and vehicle swaps. */
export interface CarInteriorAssemblyHost {
    vehicleType: VehicleType;
    vehicleConfig: VehicleConfig;
    quality: 'high' | 'medium' | 'low';
    gpuProfile: { name: string };
    reducedMotion: boolean;
    interiorGroup: THREE.Group;
    roofGroup: THREE.Group;
    geometryFactory: GeometryFactory;
    lodManager: LODManager;
    lodConfig: VehicleLODConfig;
    frustumCuller: FrustumCuller;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    canvas: HTMLCanvasElement;
    postProcessing?: import('./PostProcessingManager').PostProcessingManager;
    rainSystem?: RainSystem;
    dustMoteSystem?: DustMoteSystem;
    microInteractions: InteriorMicroInteractions;
    leverCallbacks: CabinLeverCallbacks;
    dashboardMaterial: THREE.MeshStandardMaterial;
    leatherMaterial: THREE.MeshStandardMaterial;
    metalMaterial: THREE.MeshStandardMaterial;
    frameMaterial: THREE.MeshStandardMaterial;
    glassMaterial: THREE.MeshStandardMaterial;
    mirrorMaterial: THREE.MeshStandardMaterial;
    accentMaterial: THREE.MeshStandardMaterial;
    chromeMaterial?: THREE.MeshStandardMaterial;
    steeringWheelGroup: THREE.Group;
    wiperLeft: THREE.Group;
    wiperRight: THREE.Group;
    windshieldGlassMesh: THREE.Mesh;
    rearGlassMesh: THREE.Mesh;
    leftMirrorPlane?: THREE.Mesh;
    rightMirrorPlane?: THREE.Mesh;
    instrumentClusterMat: THREE.MeshStandardMaterial;
    centerDisplayMat: THREE.MeshStandardMaterial;
    domeLightFixtureMesh: THREE.Mesh;
    domeSwitchMesh: THREE.Mesh;
    speedometerNeedle: THREE.Mesh;
    tachometerNeedle: THREE.Mesh;
    gaugeRig: GaugeRig | null;
    digitalClockMesh: THREE.Mesh | null;
    clockUpdateInterval?: number;
    locationPanel: LocationPanel | null;
    lastLocationInfo: import('../../utils/panoLocation').PanoLocationInfo | null;
    lastCompassHeading: number;
    lastMediaInfo: { name: string; tags: string; playing: boolean };
    sunShafts: SunShafts | null;
    centerDisplay: CenterDisplay | null;
    cupLiquidMaterial?: THREE.ShaderMaterial;
    vanityMirror?: VanityMirror;
    vanityMirrorMesh?: THREE.Mesh;
    windowWeatherOverlay?: WindowWeatherOverlay;
    detailMeshes: THREE.Mesh[];
    lodUpdateFn?: () => void;
    animator?: CarInteriorAnimator;
    rendererDelegate?: CarInteriorRenderer;
    lightingManager?: CarInteriorLightingManager;
    postProcessingEnabled: boolean;
    isRoofOpen: boolean;
    roofTargetY: number;
    seatOffset: number;
    driverSeatGroup: THREE.Group;
    applySeatPosition: () => void;
    emitterGlowSprites?: CabinGlowSprite[];
    proceduralCabinGroup?: THREE.Group;
    gltfCabinGroup?: THREE.Group;
    gltfInteriorApplied?: boolean;
    onCabinSocketsChanged?: () => void;
}

export function setupCarInteriorLOD(host: CarInteriorAssemblyHost): void {
    host.interiorGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
            if (obj.geometry.type.includes('Torus') ||
                obj.geometry.type.includes('Circle') ||
                obj.name.includes('gauge') ||
                obj.name.includes('detail')) {
                host.detailMeshes.push(obj);
            }
        }
    });

    host.lodUpdateFn = setupVehicleInteriorLOD(
        host.interiorGroup,
        host.camera,
        host.lodConfig
    );

    console.log('[CarInterior] LOD configured with', host.detailMeshes.length, 'detail meshes');
}

export function setupWindowWeatherOverlay(host: CarInteriorAssemblyHost): void {
    host.windowWeatherOverlay?.dispose();
    host.windowWeatherOverlay = undefined;
    if (host.windshieldGlassMesh && host.quality !== 'low') {
        host.windowWeatherOverlay = new WindowWeatherOverlay(host.windshieldGlassMesh);
        host.interiorGroup.add(host.windowWeatherOverlay.getMesh());
    }
    if (host.dustMoteSystem && !host.interiorGroup.children.includes(host.dustMoteSystem.getObject())) {
        host.interiorGroup.add(host.dustMoteSystem.getObject());
    }
    if (host.rainSystem && !host.interiorGroup.children.includes(host.rainSystem.getMesh())) {
        host.interiorGroup.add(host.rainSystem.getMesh());
    }
}

export function buildInteriorFromBuilder(host: CarInteriorAssemblyHost): void {
    if (resetGlowRegistry) resetGlowRegistry();

    if (!host.proceduralCabinGroup) {
        host.proceduralCabinGroup = new THREE.Group();
        host.proceduralCabinGroup.name = 'proceduralCabin';
        host.interiorGroup.add(host.proceduralCabinGroup);
    } else {
        host.proceduralCabinGroup.clear();
        host.proceduralCabinGroup.visible = true;
    }
    const cabin = host.proceduralCabinGroup;
    host.gltfInteriorApplied = false;

    const builder = new CarInteriorBuilder(
        cabin,
        host.roofGroup,
        host.vehicleConfig,
        host.quality,
        host.geometryFactory,
        host.lodManager,
        {
            dashboard: host.dashboardMaterial,
            leather: host.leatherMaterial,
            metal: host.metalMaterial,
            frame: host.frameMaterial,
            glass: host.glassMaterial,
            mirror: host.mirrorMaterial,
            accent: host.accentMaterial,
            chrome: (host.chromeMaterial as THREE.MeshStandardMaterial) || host.metalMaterial,
        } as import('./MaterialFactory').MaterialSet,
        host.reducedMotion,
    );

    const buildResult = builder.buildAll();
    host.steeringWheelGroup = buildResult.steeringWheelGroup;
    host.wiperLeft = buildResult.wiperLeft;
    host.wiperRight = buildResult.wiperRight;
    host.windshieldGlassMesh = buildResult.windshieldGlassMesh;
    host.rearGlassMesh = buildResult.rearGlassMesh;
    host.leftMirrorPlane = buildResult.leftMirrorPlane;
    host.rightMirrorPlane = buildResult.rightMirrorPlane;
    host.instrumentClusterMat = buildResult.instrumentClusterMat;
    host.centerDisplayMat = buildResult.centerDisplayMat;
    host.domeLightFixtureMesh = buildResult.domeLightFixtureMesh;
    host.domeSwitchMesh = buildResult.domeSwitchMesh;
    host.emitterGlowSprites = buildResult.glowSprites ?? [];

    if (!host.vehicleConfig.hasGauges) {
        host.gaugeRig = null;
        host.digitalClockMesh = null;
    }
    if (host.vehicleConfig.hasGauges) {
        const gaugeResult = CarInteriorGauges.build(
            cabin,
            host.metalMaterial,
            host.vehicleConfig,
            host.gpuProfile as import('../../utils/performance').GPUPerformanceProfile,
            host.quality
        );
        host.speedometerNeedle = gaugeResult.speedometerNeedle;
        host.tachometerNeedle = gaugeResult.tachometerNeedle;
        host.gaugeRig = gaugeResult.gaugeRig ?? null;
        host.digitalClockMesh = gaugeResult.digitalClockMesh ?? null;
        host.clockUpdateInterval = gaugeResult.clockUpdateInterval;
    }

    host.lightingManager?.rebindCabin({
        domeLightFixtureMesh: host.domeLightFixtureMesh,
        domeSwitchMesh: host.domeSwitchMesh,
        digitalClockMesh: host.digitalClockMesh,
        instrumentClusterMat: host.instrumentClusterMat,
        centerDisplayMat: host.centerDisplayMat,
        dashboardMaterial: host.dashboardMaterial,
        leatherMaterial: host.leatherMaterial,
        frameMaterial: host.frameMaterial,
        windshieldGlassMesh: host.windshieldGlassMesh,
        rearGlassMesh: host.rearGlassMesh,
        clinical: host.vehicleConfig.theme === 'clinical',
        emitterGlows: host.emitterGlowSprites,
        dashLightColor: parseInt(host.vehicleConfig.accentColor.replace('#', '0x')),
    });

    if (host.vehicleConfig.hasDashboard && host.quality !== 'low') {
        host.locationPanel?.dispose();
        host.locationPanel = new LocationPanel(host.vehicleConfig.accentColor, host.gpuProfile.name);
        cabin.add(host.locationPanel.mesh);
        host.locationPanel.setLocation(host.lastLocationInfo);
        host.locationPanel.setHeading(host.lastCompassHeading);
        host.locationPanel.setNightGlow(host.lightingManager?.getSunNightFactor() ?? 0);
    }

    host.sunShafts?.dispose();
    host.sunShafts = null;
    if (host.quality !== 'low') {
        host.sunShafts = new SunShafts(host.reducedMotion);
        host.interiorGroup.add(host.sunShafts.group);
    }

    host.centerDisplay?.dispose();
    host.centerDisplay = null;
    if (host.vehicleConfig.hasDashboard && host.quality !== 'low') {
        host.centerDisplay = new CenterDisplay(host.vehicleConfig, host.gpuProfile.name);
        cabin.add(host.centerDisplay.group);
        host.centerDisplay.setLocation(host.lastLocationInfo);
        host.centerDisplay.setHeading(host.lastCompassHeading);
        host.centerDisplay.setMedia(host.lastMediaInfo.name, host.lastMediaInfo.tags, host.lastMediaInfo.playing);
        host.centerDisplay.setNightGlow(host.lightingManager?.getSunNightFactor() ?? 0);
    }

    if (host.quality !== 'low') {
        const detail = CarInteriorDetailProps.build(
            cabin,
            {
                dashboard: host.dashboardMaterial,
                leather: host.leatherMaterial,
                metal: host.metalMaterial,
                frame: host.frameMaterial,
                glass: host.glassMaterial,
                mirror: host.mirrorMaterial,
                accent: host.accentMaterial,
                chrome: (host.chromeMaterial as THREE.MeshStandardMaterial) || host.metalMaterial,
            } as import('./MaterialFactory').MaterialSet,
            host.quality,
            {
                onWiperStalk: (position) => host.leverCallbacks.onWiperStalk?.(position),
                onGear: (gear) => host.leverCallbacks.onGear?.(gear),
            }
        );
        host.cupLiquidMaterial = detail.cupLiquidMaterial;
        if (!host.microInteractions) {
            throw new Error(
                '[CarInterior] microInteractions must be bound on the host before cabin assembly',
            );
        }
        host.microInteractions.register(detail.interactives);
        host.animator?.setCupLiquidMaterial(host.cupLiquidMaterial);

        host.vanityMirror?.dispose();
        host.vanityMirror = undefined;
        host.vanityMirrorMesh = detail.vanityMirrorMesh;
        if (host.vanityMirrorMesh) {
            host.vanityMirror = new VanityMirror(host.scene, host.renderer, host.vanityMirrorMesh);
        }
    }

    host.animator?.setGaugeRig(host.gaugeRig);
}

export async function applyHeroCabinIfEnabled(host: CarInteriorAssemblyHost): Promise<void> {
    if (!isGltfInteriorEnabled()) return;
    try {
        const kit = await loadGltfInteriorKit();
        if (!kit) return;
        const ok = await applyGltfInterior(kit, host);
        if (!ok) return;
        setupWindowWeatherOverlay(host);
        host.animator?.rebindSockets({
            steeringWheelGroup: host.steeringWheelGroup,
            wiperLeft: host.wiperLeft,
            wiperRight: host.wiperRight,
            speedometerNeedle: host.speedometerNeedle,
            tachometerNeedle: host.tachometerNeedle,
            windowOverlay: host.windowWeatherOverlay,
        });
        host.lightingManager?.rebindCabin({
            domeLightFixtureMesh: host.domeLightFixtureMesh,
            domeSwitchMesh: host.domeSwitchMesh,
            digitalClockMesh: host.digitalClockMesh,
            instrumentClusterMat: host.instrumentClusterMat,
            centerDisplayMat: host.centerDisplayMat,
            windshieldGlassMesh: host.windshieldGlassMesh,
            rearGlassMesh: host.rearGlassMesh,
        });
        host.onCabinSocketsChanged?.();
    } catch (err) {
        console.warn('[gltfInterior] hero cabin skipped', err);
    }
}

export function rebuildCarInteriorForVehicle(host: CarInteriorAssemblyHost, vehicleType: VehicleType): void {
    if (host.vehicleType === vehicleType) return;

    host.vehicleType = vehicleType;
    host.vehicleConfig = getVehicleConfig(vehicleType);

    host.interiorGroup.clear();
    host.roofGroup.clear();
    host.proceduralCabinGroup = undefined;
    host.gltfCabinGroup = undefined;
    host.gltfInteriorApplied = false;
    host.interiorGroup.add(host.driverSeatGroup);
    host.lightingManager?.attachCabinLights(host.interiorGroup);

    if (host.clockUpdateInterval !== undefined) {
        clearInterval(host.clockUpdateInterval);
        host.clockUpdateInterval = undefined;
    }

    host.applySeatPosition();
    host.rendererDelegate?.setCameraFov(resolveCameraFov(host.vehicleConfig));

    const mats = createMaterials(host.vehicleConfig, host.gpuProfile as import('../../utils/performance').GPUPerformanceProfile);
    host.dashboardMaterial = mats.dashboard;
    host.chromeMaterial = (mats as { chrome?: THREE.MeshStandardMaterial }).chrome;
    host.leatherMaterial = mats.leather;
    host.metalMaterial = mats.metal;
    host.frameMaterial = mats.frame;
    host.glassMaterial = mats.glass;
    host.mirrorMaterial = mats.mirror;
    host.accentMaterial = mats.accent;
    host.chromeMaterial = (mats as { chrome?: THREE.MeshStandardMaterial }).chrome ?? host.chromeMaterial;

    buildInteriorFromBuilder(host);
    setupWindowWeatherOverlay(host);
    void applyHeroCabinIfEnabled(host);

    if (host.vehicleConfig.hasRoof) {
        host.isRoofOpen = false;
        host.roofTargetY = 1.6;
    } else {
        host.isRoofOpen = true;
        host.roofTargetY = -1.0;
    }
}
