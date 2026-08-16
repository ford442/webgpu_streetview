import * as THREE from 'three';
import { VehicleType, VehicleConfig, getVehicleConfig } from './VehicleManager';
import { FrustumCuller, VehicleLODConfig, detectGPUProfile } from '../utils/performance';
import { PanoLocationInfo } from '../utils/panoLocation';
import { CarInteriorAnimator } from './interior/CarInteriorAnimator';
import { CarInteriorRenderer } from './interior/CarInteriorRenderer';
import { CarInteriorLightingManager } from './interior/CarInteriorLightingManager';
import { InteractionHelper } from './interior/InteractionHelper';
import { GeometryFactory } from './interior/GeometryFactory';
import { LODManager } from './interior/LODManager';
import { PostProcessingManager } from './interior/PostProcessingManager';
import { RainSystem } from './interior/RainSystem';
import { DustMoteSystem } from './interior/DustMoteSystem';
import { WindowWeatherOverlay } from './interior/WindowWeatherOverlay';
import { InteriorMicroInteractions } from './interior/InteriorMicroInteractions';
import { CabinLeverCallbacks } from './interior/CarInteriorDetailProps';
import {
    GEAR_POSITIONS,
    SHIFTER_KNOB_MESH,
    WIPER_STALK_MESH,
    WIPER_STALK_POSITIONS,
    type GearPosition,
    type WiperStalkPosition,
} from './interior/CabinControls';
import { VanityMirror } from './interior/VanityMirror';
import { CenterDisplay } from './interior/CenterDisplay';
import { SunShafts } from './interior/SunShafts';
import { PanoEnvironment } from './interior/PanoEnvironment';
import { PerformanceProfiler } from './interior/PerformanceProfiler';
import { LocationPanel } from './interior/LocationPanel';
import type { GaugeRig } from './interior/CarInteriorGauges';
import {
    rebuildCarInteriorForVehicle,
    type CarInteriorAssemblyHost,
} from './interior/CarInteriorAssembly';
import { bootstrapCarInterior } from './interior/CarInteriorBootstrap';
import { disposeCarInteriorResources } from './interior/CarInteriorDispose';

/**
 * CarInterior - Manages the 3D car interior shell, materials, and roof animation.
 */
export class CarInterior implements CarInteriorAssemblyHost {
    public scene!: THREE.Scene;
    public camera!: THREE.PerspectiveCamera;
    public renderer!: THREE.WebGLRenderer;
    public canvas!: HTMLCanvasElement;
    public interiorGroup!: THREE.Group;
    public roofGroup!: THREE.Group;
    public driverSeatGroup!: THREE.Group;
    public steeringWheelGroup!: THREE.Group;
    public wiperLeft!: THREE.Group;
    public wiperRight!: THREE.Group;
    public speedometerNeedle!: THREE.Mesh;
    public tachometerNeedle!: THREE.Mesh;
    public gaugeRig: GaugeRig | null = null;
    public headlightsLight!: THREE.SpotLight;
    public domeLightSource!: THREE.PointLight;
    public domeLightFixtureMesh!: THREE.Mesh;
    public domeSwitchMesh!: THREE.Mesh;
    public interiorBounceLight!: THREE.PointLight;
    public sunLight!: THREE.DirectionalLight;
    public panoEnvironment!: PanoEnvironment;
    public ambientLight!: THREE.AmbientLight;
    public hemisphereLight!: THREE.HemisphereLight;
    public overheadLight!: THREE.DirectionalLight;
    public leftWindowLight: THREE.PointLight | undefined;
    public rightWindowLight: THREE.PointLight | undefined;
    public instrumentClusterMat!: THREE.MeshStandardMaterial;
    public centerDisplayMat!: THREE.MeshStandardMaterial;
    public windshieldGlassMesh!: THREE.Mesh;
    public rearGlassMesh!: THREE.Mesh;
    public digitalClockMesh: THREE.Mesh | null = null;
    public clockUpdateInterval?: number;
    public locationPanel: LocationPanel | null = null;
    public lastLocationInfo: PanoLocationInfo | null = null;
    public lastCompassHeading = 0;
    public centerDisplay: CenterDisplay | null = null;
    public lastMediaInfo: { name: string; tags: string; playing: boolean } = { name: '', tags: '', playing: false };
    public sunShafts: SunShafts | null = null;
    public lastSunAzimuth = 0;
    public lastSunAltitude = -1;
    public isRoofOpen = false;
    public roofTargetY = 0;
    public animationId = 0;
    public interaction!: InteractionHelper;
    public reducedMotion!: boolean;
    public geometryFactory!: GeometryFactory;
    public lodManager!: LODManager;
    public postProcessing?: PostProcessingManager;
    public rainSystem?: RainSystem;
    public dustMoteSystem?: DustMoteSystem;
    public windowWeatherOverlay?: WindowWeatherOverlay;
    public microInteractions!: InteriorMicroInteractions;
    public leverCallbacks: CabinLeverCallbacks = {};
    public cupLiquidMaterial?: THREE.ShaderMaterial;
    public vanityMirror?: VanityMirror;
    public vanityMirrorMesh?: THREE.Mesh;
    public postProcessingEnabled = false;
    public profiler?: PerformanceProfiler;
    public vehicleType!: VehicleType;
    public vehicleConfig!: VehicleConfig;
    public dashboardMaterial!: THREE.MeshStandardMaterial;
    public leatherMaterial!: THREE.MeshStandardMaterial;
    public metalMaterial!: THREE.MeshStandardMaterial;
    public frameMaterial!: THREE.MeshStandardMaterial;
    public glassMaterial!: THREE.MeshStandardMaterial;
    public mirrorMaterial!: THREE.MeshStandardMaterial;
    public accentMaterial!: THREE.MeshStandardMaterial;
    public chromeMaterial?: THREE.MeshStandardMaterial;
    public lodUpdateFn?: () => void;
    public frustumCuller!: FrustumCuller;
    public lodConfig!: VehicleLODConfig;
    public detailMeshes: THREE.Mesh[] = [];
    public quality: 'high' | 'medium' | 'low' = 'high';
    public gpuProfile = detectGPUProfile();
    public animator!: CarInteriorAnimator;
    public rendererDelegate!: CarInteriorRenderer;
    public lightingManager!: CarInteriorLightingManager;
  public seatOffset = 0;

    constructor(container: HTMLElement, vehicleType: VehicleType = 'sedan') {
        this.vehicleType = vehicleType;
        this.vehicleConfig = getVehicleConfig(vehicleType);
        this.roofTargetY = this.vehicleConfig.hasRoof ? 1.6 : -1.0;
        this.isRoofOpen = !this.vehicleConfig.hasRoof;

        const boot = bootstrapCarInterior(
            container,
            vehicleType,
            this,
            () => this.applySeatPosition(),
        );

        this.scene = boot.scene;
        this.camera = boot.camera;
        this.renderer = boot.renderer;
        this.canvas = boot.canvas;
        this.interiorGroup = boot.interiorGroup;
        this.roofGroup = boot.roofGroup;
        this.driverSeatGroup = boot.driverSeatGroup;
        this.frustumCuller = boot.frustumCuller;
        this.lodConfig = boot.lodConfig;
        this.reducedMotion = boot.reducedMotion;
        this.interaction = boot.interaction;
        this.geometryFactory = boot.geometryFactory;
        this.lodManager = boot.lodManager;
        this.postProcessing = boot.postProcessing;
        this.rainSystem = boot.rainSystem;
        this.dustMoteSystem = boot.dustMoteSystem;
        this.microInteractions = boot.microInteractions;
        this.profiler = boot.profiler;
        this.hemisphereLight = boot.hemisphereLight;
        this.ambientLight = boot.ambientLight;
        this.overheadLight = boot.overheadLight;
        this.leftWindowLight = boot.leftWindowLight;
        this.rightWindowLight = boot.rightWindowLight;
        this.headlightsLight = boot.headlightsLight;
        this.interiorBounceLight = boot.interiorBounceLight;
        this.domeLightSource = boot.domeLightSource;
        this.sunLight = boot.sunLight;
        this.panoEnvironment = boot.panoEnvironment;
        this.animator = boot.animator;
        this.rendererDelegate = boot.rendererDelegate;
        this.lightingManager = boot.lightingManager;
        this.gpuProfile = boot.gpuProfile;
        this.quality = boot.quality;
        this.postProcessingEnabled = boot.postProcessingEnabled;
    }

    public setEnvironmentFromPano(equirect: HTMLCanvasElement, centerHeading: number): void {
        this.panoEnvironment.setFromEquirect(equirect, centerHeading);
        this.panoEnvironment.setIntensity(this.lightingManager.getIblIntensity());
    }

    public setSunPosition(azimuth: number, altitude: number): void {
        this.lightingManager.setSunState(azimuth, altitude);
        const night = this.lightingManager.getSunNightFactor();
        this.panoEnvironment.setIntensity(this.lightingManager.getIblIntensity());
        this.locationPanel?.setNightGlow(night);
        this.centerDisplay?.setNightGlow(night);
        this.lastSunAzimuth = azimuth;
        this.lastSunAltitude = altitude;
        const sunVisibility = Math.max(0, Math.min(1, altitude / 0.35));
        this.animator?.setAmbientState({ sunVisibility });
        this.animator?.setNightFactor(this.lightingManager.getEffectiveNight());
    }

    public setLocationInfo(info: PanoLocationInfo | null): void {
        this.lastLocationInfo = info;
        this.locationPanel?.setLocation(info);
        this.centerDisplay?.setLocation(info);
    }

    public setCompassHeading(heading: number): void {
        this.lastCompassHeading = heading;
        this.locationPanel?.setHeading(heading);
        this.centerDisplay?.setHeading(heading);
    }

    public setVehicleType(vehicleType: VehicleType): void {
        rebuildCarInteriorForVehicle(this, vehicleType);
        this.animator?.setRoofTargetY(this.roofTargetY);
    }

    public toggleRoof(): void {
        this.isRoofOpen = !this.isRoofOpen;
        this.roofTargetY = this.isRoofOpen ? -1.0 : 1.6;
        this.animator?.setRoofTargetY(this.roofTargetY);
    }

    public update(deltaTime: number, carSpeedKmh = 0): void {
        this.animator.update(deltaTime, carSpeedKmh);
        this.centerDisplay?.update(deltaTime);
        if (this.sunShafts) {
            const carHeadingRad = -this.interiorGroup.rotation.y;
            this.sunShafts.update(
                deltaTime,
                this.lastSunAzimuth,
                this.lastSunAltitude,
                carHeadingRad,
                this.lightingManager?.getWeatherIntensity() ?? 0
            );
        }
    }

    public setActive(active: boolean): void {
        this.animator.setActive(active);
    }

    public setCarOrientation(carHeading: number, bodyPitch = 0, bodyRoll = 0): void {
        this.animator.setCarOrientation(carHeading, bodyPitch, bodyRoll);
    }

    public setHeadOrientation(headYaw: number, headPitch: number): void {
        this.animator.setHeadOrientation(headYaw, headPitch);
    }

    public setSteeringAngle(angle: number): void {
        this.animator.setSteeringAngle(angle);
    }

    public setWipersActive(active: boolean): void {
        this.animator.setWipersActive(active);
    }

    public setWiperSpeed(speed: number): void {
        this.animator.setWiperSpeed(speed);
    }

    public setWiperIntermittent(intermittent: boolean): void {
        this.animator.setWiperIntermittent(intermittent);
    }

    public setLeverCallbacks(callbacks: CabinLeverCallbacks): void {
        this.leverCallbacks = callbacks;
    }

    public syncWiperStalkMesh(position: WiperStalkPosition): void {
        this.microInteractions.setLeverIndexByName(
            WIPER_STALK_MESH,
            WIPER_STALK_POSITIONS.indexOf(position)
        );
    }

    public syncShifterMesh(gear: GearPosition): void {
        this.microInteractions.setLeverIndexByName(
            SHIFTER_KNOB_MESH,
            GEAR_POSITIONS.indexOf(gear)
        );
    }

    public updateWindowTint(val: number): void {
        this.lightingManager.updateWindowTint(val);
    }

    public setGaugeValues(speed: number, rpm: number): void {
        this.animator.setGaugeValues(speed, rpm);
    }

    public toggleHeadlights(): void {
        this.lightingManager.toggleHeadlights();
    }

    public getHeadlightsState(): boolean {
        return this.lightingManager.getHeadlightsState();
    }

    public setHeadlights(on: boolean): void {
        this.lightingManager.setHeadlights(on);
    }

    public toggleDomeLight(): boolean {
        return this.lightingManager.toggleDomeLight();
    }

    public getDomeLightState(): boolean {
        return this.lightingManager.getDomeLightState();
    }

    public setDomeLight(on: boolean): void {
        this.lightingManager.setDomeLight(on);
    }

    public setInteriorLighting(headlightsOn: boolean, nightIntensity: number, domeLightOn: boolean): void {
        this.lightingManager.setInteriorLighting(headlightsOn, nightIntensity, domeLightOn);
        this.panoEnvironment.setIntensity(this.lightingManager.getIblIntensity(nightIntensity));
        this.animator?.setNightFactor(this.lightingManager.getEffectiveNight(nightIntensity));
    }

    public isDomeSwitchHit(clientX: number, clientY: number): boolean {
        if (!this.domeSwitchMesh) return false;
        return this.interaction.hitTest(
            clientX, clientY, this.canvas.getBoundingClientRect(),
            this.camera, this.domeSwitchMesh, false
        );
    }

    public isSteeringWheelHit(clientX: number, clientY: number): boolean {
        if (!this.steeringWheelGroup) return false;
        return this.interaction.hitTest(
            clientX, clientY, this.canvas.getBoundingClientRect(),
            this.camera, this.steeringWheelGroup, true
        );
    }

    public setRainActive(active: boolean): void {
        if (this.rainSystem) this.rainSystem.setActive(active);
    }

    public setWeatherAmbient(opts: {
        rainIntensity: number;
        wind: number;
        fogDensity: number;
        snowIntensity?: number;
        sunAltitude?: number;
        lightShaftFactor?: number;
        convertibleOpen?: boolean;
    }): void {
        const rainNorm = opts.rainIntensity / 100;
        const windNorm = opts.wind / 100;
        const fogNorm = opts.fogDensity / 100;
        const snowNorm = (opts.snowIntensity ?? 0) / 100;
        const humidityNorm = Math.min(1, fogNorm * 0.55 + rainNorm * 0.25 + snowNorm * 0.35);
        const sunVisibility = opts.sunAltitude !== undefined
            ? Math.max(0, Math.min(1, opts.sunAltitude / 0.35))
            : 0.4;
        const lightShaftFactor = opts.lightShaftFactor ?? sunVisibility * (1 - fogNorm * 0.6);
        this.animator?.setAmbientState({
            rainNorm,
            windNorm,
            fogNorm,
            humidityNorm,
            sunVisibility,
            lightShaftFactor,
            convertibleOpen: opts.convertibleOpen ?? false,
        });
    }

    public setWeatherIntensity(rain: number): void {
        this.lightingManager?.setWeatherIntensity?.(rain);
        this.rainSystem?.setActive(rain > 0.02);
        this.animator?.setAmbientState({ rainNorm: rain });
    }

    public triggerInteriorPress(meshName: string): boolean {
        return this.microInteractions.triggerPressByName(meshName);
    }

    public setVanityStreetViewCanvas(canvas: HTMLCanvasElement | null): void {
        this.vanityMirror?.setStreetViewCanvas(canvas);
    }

    public updateVanityMirror(viewHeading: number, headPitch: number): void {
        this.vanityMirror?.update(viewHeading, headPitch, true);
    }

    public setMediaInfo(name: string, tags: string, playing: boolean): void {
        this.lastMediaInfo = { name, tags, playing };
        this.centerDisplay?.setMedia(name, tags, playing);
    }

    public isCenterDisplayHit(clientX: number, clientY: number): boolean {
        return this.centerDisplay?.isHit?.(clientX, clientY) ?? false;
    }

    public cycleDisplayPage(): string | null {
        return this.centerDisplay?.cyclePage() ?? null;
    }

    public setInteriorEditMode(enabled: boolean): void {
        this.microInteractions.setInteriorEditMode(enabled);
    }

    public handleInteriorPointerDown(clientX: number, clientY: number, editMode: boolean): boolean {
        return this.microInteractions.handlePointerDown(
            clientX,
            clientY,
            this.canvas.getBoundingClientRect(),
            this.camera,
            this.interiorGroup,
            editMode
        );
    }

    public handleInteriorPointerMove(clientX: number, clientY: number): boolean {
        return this.microInteractions.handlePointerMove(clientX, clientY);
    }

    public handleInteriorPointerUp(): void {
        this.microInteractions.handlePointerUp();
    }

    public setPostProcessingEnabled(enabled: boolean): void {
        this.postProcessingEnabled = enabled;
        this.rendererDelegate.setPostProcessingEnabled(enabled);
    }

    public setBloomStrength(strength: number): void {
        this.rendererDelegate.setBloomStrength(strength);
    }

    public setZoomFOV(zoom: number): void {
        this.rendererDelegate.setZoomFOV(zoom);
    }

    public applySeatPosition(): void {
        if (!this.driverSeatGroup || !this.vehicleConfig?.cameraPosition) {
            return;
        }
        const { x, y, z } = this.vehicleConfig.cameraPosition;
        this.driverSeatGroup.position.set(x, y, z + this.seatOffset);
    }

    public setSeatOffset(offset: number): void {
        this.seatOffset = offset;
        this.applySeatPosition();
    }

    public getPerformanceString(): string {
        return this.profiler?.format() ?? '';
    }

    public render(): void {
        this.rendererDelegate.render();
    }

    public dispose(): void {
        disposeCarInteriorResources(this);
    }
}
