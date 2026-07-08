import * as THREE from 'three';
import { VehicleType, VehicleConfig, getVehicleConfig } from './VehicleManager';
import { 
  setupVehicleInteriorLOD, 
  VehicleLODConfig, 
  FrustumCuller, 
  optimizeTextures,
  applyPerformanceProfile,
  detectGPUProfile
} from '../utils/performance';
import { CarInteriorBuilder } from './interior/CarInteriorBuilder';
import { CarInteriorGauges, GaugeRig } from './interior/CarInteriorGauges';
import { LocationPanel } from './interior/LocationPanel';
import { CenterDisplay, DisplayPage } from './interior/CenterDisplay';
import { SunShafts } from './interior/SunShafts';
import { resetGlowRegistry } from './interior/MaterialFactory';
import { PanoLocationInfo } from '../utils/panoLocation';
import { CarInteriorAnimator } from './interior/CarInteriorAnimator';
import { CarInteriorRenderer } from './interior/CarInteriorRenderer';
import { CarInteriorLightingManager } from './interior/CarInteriorLightingManager';
import { getMemoryProfiler, MemoryProfiler } from '../utils/memoryProfiler';
import { InteractionHelper } from './interior/InteractionHelper';
import { createMaterials } from './interior/MaterialFactory';
import { GeometryFactory } from './interior/GeometryFactory';
import { LODManager } from './interior/LODManager';
import { PostProcessingManager } from './interior/PostProcessingManager';
import { RainSystem } from './interior/RainSystem';
import { buildInteriorLighting } from './interior/LightingBuilder';
import { PanoEnvironment } from './interior/PanoEnvironment';
import { PerformanceProfiler } from './interior/PerformanceProfiler';

/**
 * CarInterior - Manages the 3D car interior shell, materials, and roof animation.
 * Uses Three.js primitives to create vehicle-specific interiors.
 * Renders as an overlay with transparent background so the Street View panorama shows through windows.
 */
export class CarInterior {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public canvas: HTMLCanvasElement;
    public interiorGroup: THREE.Group;
    public roofGroup: THREE.Group;
    /** Anchored at the driver's eye position inside the car; child of interiorGroup */
    private driverSeatGroup: THREE.Group;
    /** User seat-distance offset (metres) added to the config eye position along +Z (dolly back). */
    private seatOffset: number = 0;
    private steeringWheelGroup!: THREE.Group;
    private leftMirrorPlane!: THREE.Mesh;
    private rightMirrorPlane!: THREE.Mesh;
    private wiperLeft!: THREE.Group;
    private wiperRight!: THREE.Group;
    private speedometerNeedle!: THREE.Mesh;
    private tachometerNeedle!: THREE.Mesh;
    private gaugeRig: GaugeRig | null = null;
    private headlightsLight!: THREE.SpotLight;
    private domeLightSource!: THREE.PointLight;
    private domeLightFixtureMesh!: THREE.Mesh;
    private domeSwitchMesh!: THREE.Mesh;
    private interiorBounceLight!: THREE.PointLight;
    private sunLight!: THREE.DirectionalLight;
    private panoEnvironment!: PanoEnvironment;
    private ambientLight!: THREE.AmbientLight;
    private hemisphereLight!: THREE.HemisphereLight;
    private overheadLight!: THREE.DirectionalLight;
    private leftWindowLight!: THREE.PointLight;
    private rightWindowLight!: THREE.PointLight;
    private instrumentClusterMat!: THREE.MeshStandardMaterial;
    private centerDisplayMat!: THREE.MeshStandardMaterial;
    private windshieldGlassMesh!: THREE.Mesh;
    private rearGlassMesh!: THREE.Mesh;

    // Digital Clock
    private digitalClockMesh: THREE.Mesh | null = null;
    private clockCanvas: HTMLCanvasElement | null = null;
    private clockCtx: CanvasRenderingContext2D | null = null;
    private clockUpdateInterval?: number;

    // Location readout dash panel (road/area, coords, heading, capture date)
    private locationPanel: LocationPanel | null = null;
    private lastLocationInfo: PanoLocationInfo | null = null;
    private lastCompassHeading: number = 0;

    // Centre-stack infotainment display (nav / media / trip pages)
    private centerDisplay: CenterDisplay | null = null;

    // Fake volumetric light shafts through the side windows at low sun
    private sunShafts: SunShafts | null = null;
    private lastSunAzimuth: number = 0;
    private lastSunAltitude: number = -1;
    private lastMediaInfo: { name: string; tags: string; playing: boolean } = { name: '', tags: '', playing: false };

    private isActive: boolean = true;

    private isRoofOpen: boolean = false;
    private roofTargetY: number = 0;
    private animationId: number = 0;
    private steeringAngle: number = 0;
    private wiperAnimationTime: number = 0;
    private isWiperActive: boolean = false;
    private speedometer: number = 0; // 0-100 km/h
    private tachometer: number = 0; // 0-8000 RPM
    private interaction: InteractionHelper;
    private reducedMotion: boolean;
    private geometryFactory: GeometryFactory;
    private lodManager: LODManager;
    private postProcessing?: PostProcessingManager;
    private rainSystem?: RainSystem;
    private postProcessingEnabled = false; // Post-FX breaks alpha compositing over WebGPU panorama
    private profiler?: PerformanceProfiler;

    private vehicleType: VehicleType = 'sedan';
    private vehicleConfig: VehicleConfig;

    // Materials
    private dashboardMaterial!: THREE.MeshStandardMaterial;
    private leatherMaterial!: THREE.MeshStandardMaterial;
    private metalMaterial!: THREE.MeshStandardMaterial;
    private frameMaterial!: THREE.MeshStandardMaterial;
    private glassMaterial!: THREE.MeshStandardMaterial;
    private mirrorMaterial!: THREE.MeshStandardMaterial;
    private accentMaterial!: THREE.MeshStandardMaterial;
    private chromeMaterial!: THREE.MeshPhysicalMaterial;

    // Performance optimization
    private lodUpdateFn?: () => void;
    private frustumCuller: FrustumCuller;
    private lodConfig: VehicleLODConfig;
    private detailMeshes: THREE.Mesh[] = [];
    private quality: 'high' | 'medium' | 'low' = 'high';
    private gpuProfile = detectGPUProfile();
    private animator!: CarInteriorAnimator;
    private rendererDelegate!: CarInteriorRenderer;
    private lightingManager!: CarInteriorLightingManager;

    constructor(container: HTMLElement, vehicleType: VehicleType = 'sedan') {
        this.scene = new THREE.Scene();
        this.vehicleType = vehicleType;
        this.vehicleConfig = getVehicleConfig(vehicleType);

        // Initialize performance utilities
        this.frustumCuller = new FrustumCuller();
        this.lodConfig = {
            dashboardLOD: true,
            seatLOD: true,
            interiorDetails: true
        };

        // Camera at driver seat eye level (~1.2m), slightly angled toward center console.
        // FOV is set to 60° vertical which corresponds to ~88° horizontal at 16:9 aspect —
        // this matches Google Maps Street View zoom=1 (~90° horizontal FOV) so the 3D car
        // interior window openings stay aligned with the background panorama.
        this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.01, 100);
        // Camera starts at origin of driverSeatGroup (position set via driverSeatGroup below)
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(0, 0, 0);

        // Renderer with alpha for transparency - apply performance profile
        const useAntialias = this.gpuProfile.antialias;
        try {
            this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: useAntialias });
        } catch (err) {
            throw new Error(
                `Car mode requires WebGL, which is not available in this environment. ` +
                `(${err instanceof Error ? err.message : String(err)})`
            );
        }
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.gpuProfile.pixelRatio));
        this.renderer.setClearColor(0x000000, 0);
        // autoClear must stay true so the EffectComposer's RenderPass clears its intermediate
        // render targets each frame.  With autoClear=false the RenderPass skips the clear
        // (because renderer.autoClearColor=false), causing transparent objects to accumulate
        // alpha across frames and eventually becoming opaque — blocking the WebGPU panorama.
        this.renderer.autoClear = true;
        
        // Apply performance optimizations
        applyPerformanceProfile(this.renderer, this.gpuProfile);
        optimizeTextures(this.renderer, {
            maxTextureSize: this.gpuProfile.maxTextureSize,
            anisotropy: this.gpuProfile.name === 'high' ? 4 : 2
        });

        // Physically-based tone mapping for cinematic, realistic rendering
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        this.canvas = this.renderer.domElement;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '50';
        this.canvas.style.display = 'block';
        this.canvas.style.visibility = 'visible';
        container.appendChild(this.canvas);

        this.interiorGroup = new THREE.Group();
        this.roofGroup = new THREE.Group();
        this.scene.add(this.interiorGroup);
        this.scene.add(this.roofGroup);

        // driverSeatGroup anchors the camera at the driver's eye position.
        // It is a child of interiorGroup so it rotates with the car body automatically.
        // The camera is a child of driverSeatGroup for clean local-space head look.
        this.driverSeatGroup = new THREE.Group();
        this.applySeatPosition();
        this.interiorGroup.add(this.driverSeatGroup);
        this.driverSeatGroup.add(this.camera);

        this.reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.interaction = new InteractionHelper();
        this.geometryFactory = new GeometryFactory();
        this.lodManager = new LODManager(this.frustumCuller);
        const mats = createMaterials(this.vehicleConfig, this.gpuProfile);

        // Post-processing (bloom + SMAA) — disabled on low-end GPUs
        if (this.gpuProfile.name !== 'low') {
            this.postProcessing = new PostProcessingManager(
                this.renderer, this.scene, this.camera, this.gpuProfile
            );
        }

        // Rain droplet system
        this.rainSystem = new RainSystem(200);
        this.interiorGroup.add(this.rainSystem.getMesh());

        // Performance profiler
        this.profiler = new PerformanceProfiler(this.renderer);
        this.dashboardMaterial = mats.dashboard;
        this.leatherMaterial = mats.leather;
        this.metalMaterial = mats.metal;
        this.frameMaterial = mats.frame;
        this.glassMaterial = mats.glass;
        this.mirrorMaterial = mats.mirror;
        this.accentMaterial = mats.accent;
        this.chromeMaterial = mats.chrome;
        const lights = buildInteriorLighting(this.scene, this.interiorGroup, this.renderer, this.vehicleConfig);
        this.hemisphereLight = lights.hemisphereLight;
        this.ambientLight = lights.ambientLight;
        this.overheadLight = lights.overheadLight;
        this.leftWindowLight = lights.leftWindowLight;
        this.rightWindowLight = lights.rightWindowLight;
        this.headlightsLight = lights.headlightsLight;
        this.interiorBounceLight = lights.interiorBounceLight;
        this.domeLightSource = lights.domeLightSource;
        this.sunLight = lights.sunLight;
        this.panoEnvironment = new PanoEnvironment(this.renderer, this.scene);
        this.buildInteriorFromBuilder();
        
        // Setup LOD after building interior
        this.setupLOD();

        this.animator = new CarInteriorAnimator(
            this.camera,
            this.interiorGroup,
            this.roofGroup,
            this.steeringWheelGroup,
            this.wiperLeft,
            this.wiperRight,
            this.lodManager,
            this.rainSystem,
            this.lodUpdateFn,
            this.quality,
            this.reducedMotion
        );
        this.animator.setGaugeRig(this.gaugeRig);

        this.rendererDelegate = new CarInteriorRenderer(
            this.renderer,
            this.camera,
            this.scene,
            this.postProcessing,
            this.canvas
        );
        // Post-FX OutputPass forces opaque alpha and blocks the WebGPU panorama through glass.
        this.rendererDelegate.setPostProcessingEnabled(this.postProcessingEnabled);

        this.lightingManager = new CarInteriorLightingManager(
            this.headlightsLight,
            this.domeLightSource,
            this.domeLightFixtureMesh,
            this.domeSwitchMesh,
            this.digitalClockMesh,
            this.instrumentClusterMat,
            this.centerDisplayMat,
            this.hemisphereLight,
            this.ambientLight,
            this.overheadLight,
            this.leftWindowLight,
            this.rightWindowLight,
            this.interiorBounceLight,
            this.dashboardMaterial,
            this.leatherMaterial,
            this.frameMaterial,
            this.windshieldGlassMesh,
            this.rearGlassMesh,
            this.sunLight
        );
        this.lightingManager.setReducedMotion(this.reducedMotion);
    }

    /**
     * Rebuild the IBL environment from the current panorama's equirect image.
     * The previous PMREM render target is disposed on every swap.
     */
    public setEnvironmentFromPano(equirect: HTMLCanvasElement, centerHeading: number): void {
        this.panoEnvironment.setFromEquirect(equirect, centerHeading);
    }

    /**
     * Point the sun light at the real sun for the pano's location/time and
     * retune the cabin for day/night (env dim, panel glow, ambient tint).
     * @param azimuth  - SunCalc azimuth in radians (0 = south, positive west)
     * @param altitude - SunCalc altitude in radians (0 = horizon)
     */
    public setSunPosition(azimuth: number, altitude: number): void {
        this.lastSunAzimuth = azimuth;
        this.lastSunAltitude = altitude;
        this.lightingManager.setSunState(azimuth, altitude);
        const night = this.lightingManager.getSunNightFactor();
        this.panoEnvironment.setIntensity(1 - night * 0.7);
        this.locationPanel?.setNightGlow(night);
        this.centerDisplay?.setNightGlow(night);
    }

    /**
     * Setup Level of Detail (LOD) system for the interior
     */
    private setupLOD(): void {
        // Categorize meshes by detail level
        this.interiorGroup.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                // Tag detail meshes for LOD management
                if (obj.geometry.type.includes('Torus') || 
                    obj.geometry.type.includes('Circle') ||
                    obj.name.includes('gauge') ||
                    obj.name.includes('detail')) {
                    this.detailMeshes.push(obj);
                }
            }
        });
        
        // Setup LOD update function
        this.lodUpdateFn = setupVehicleInteriorLOD(
            this.interiorGroup, 
            this.camera, 
            this.lodConfig
        );
        
        console.log('[CarInterior] LOD configured with', this.detailMeshes.length, 'detail meshes');
    }

    /**
     * Set quality level for rendering
     */

private buildInteriorFromBuilder(): void {
        // Emissive trim/backlight materials re-register as the builders run.
        resetGlowRegistry();
        const builder = new CarInteriorBuilder(
            this.interiorGroup,
            this.roofGroup,
            this.vehicleConfig,
            this.quality,
            this.geometryFactory,
            this.lodManager,
            {
                dashboard: this.dashboardMaterial,
                leather: this.leatherMaterial,
                metal: this.metalMaterial,
                frame: this.frameMaterial,
                glass: this.glassMaterial,
                mirror: this.mirrorMaterial,
                accent: this.accentMaterial,
                chrome: this.chromeMaterial,
            }
        );

        const buildResult = builder.buildAll();
        this.steeringWheelGroup = buildResult.steeringWheelGroup;
        this.wiperLeft = buildResult.wiperLeft;
        this.wiperRight = buildResult.wiperRight;
        this.leftMirrorPlane = buildResult.leftMirrorPlane;
        this.rightMirrorPlane = buildResult.rightMirrorPlane;
        this.windshieldGlassMesh = buildResult.windshieldGlassMesh;
        this.rearGlassMesh = buildResult.rearGlassMesh;
        this.instrumentClusterMat = buildResult.instrumentClusterMat;
        this.centerDisplayMat = buildResult.centerDisplayMat;
        this.domeLightFixtureMesh = buildResult.domeLightFixtureMesh;
        this.domeSwitchMesh = buildResult.domeSwitchMesh;

        if (!this.vehicleConfig.hasGauges) {
            this.gaugeRig = null;
        }
        if (this.vehicleConfig.hasGauges) {
            const gaugeResult = CarInteriorGauges.build(
                this.interiorGroup,
                this.metalMaterial,
                this.vehicleConfig,
                this.gpuProfile,
                this.quality
            );
            this.speedometerNeedle = gaugeResult.speedometerNeedle;
            this.tachometerNeedle = gaugeResult.tachometerNeedle;
            this.gaugeRig = gaugeResult.gaugeRig;
            this.digitalClockMesh = gaugeResult.digitalClockMesh ?? null;
            this.clockCanvas = gaugeResult.clockCanvas ?? null;
            this.clockCtx = gaugeResult.clockCtx ?? null;
            this.clockUpdateInterval = gaugeResult.clockUpdateInterval;
        }

        if (this.vehicleConfig.hasDashboard && this.quality !== 'low') {
            this.locationPanel?.dispose();
            this.locationPanel = new LocationPanel(this.vehicleConfig.accentColor, this.gpuProfile.name);
            this.interiorGroup.add(this.locationPanel.mesh);
            // Re-apply the latest data so a vehicle swap keeps the current readout.
            this.locationPanel.setLocation(this.lastLocationInfo);
            this.locationPanel.setHeading(this.lastCompassHeading);
            // lightingManager is undefined during the constructor's first build;
            // on vehicle swaps it re-applies the current night glow.
            this.locationPanel.setNightGlow(this.lightingManager?.getSunNightFactor() ?? 0);
        }

        this.sunShafts?.dispose();
        this.sunShafts = null;
        if (this.quality !== 'low') {
            this.sunShafts = new SunShafts(this.reducedMotion);
            this.interiorGroup.add(this.sunShafts.group);
        }

        this.centerDisplay?.dispose();
        this.centerDisplay = null;
        if (this.vehicleConfig.hasDashboard && this.quality !== 'low') {
            this.centerDisplay = new CenterDisplay(this.vehicleConfig, this.gpuProfile.name);
            this.interiorGroup.add(this.centerDisplay.group);
            // Re-apply live state so a vehicle swap keeps the readouts.
            this.centerDisplay.setLocation(this.lastLocationInfo);
            this.centerDisplay.setHeading(this.lastCompassHeading);
            this.centerDisplay.setMedia(this.lastMediaInfo.name, this.lastMediaInfo.tags, this.lastMediaInfo.playing);
            this.centerDisplay.setNightGlow(this.lightingManager?.getSunNightFactor() ?? 0);
        }

        // On vehicle swaps the animator already exists — point it at the new
        // needles so it never animates meshes from the removed interior.
        this.animator?.setGaugeRig(this.gaugeRig);
    }

    /** Update the location readout panel with per-pano metadata. */
    public setLocationInfo(info: PanoLocationInfo | null): void {
        this.lastLocationInfo = info;
        this.locationPanel?.setLocation(info);
        this.centerDisplay?.setLocation(info);
    }

    /** Update the live compass heading on the location readout panel. */
    public setCompassHeading(heading: number): void {
        this.lastCompassHeading = heading;
        this.locationPanel?.setHeading(heading);
        this.centerDisplay?.setHeading(heading);
    }
    public setVehicleType(vehicleType: VehicleType): void {
        if (this.vehicleType === vehicleType) return;
        
        this.vehicleType = vehicleType;
        this.vehicleConfig = getVehicleConfig(vehicleType);
        
        // Clear existing interior
        this.interiorGroup.clear();
        this.roofGroup.clear();

        // Stop the clock update loop before rebuilding (buildInterior will restart it)
        if (this.clockUpdateInterval !== undefined) {
            clearInterval(this.clockUpdateInterval);
            this.clockUpdateInterval = undefined;
        }
        
        // Update camera anchor position for the new vehicle (preserving seat offset)
        this.applySeatPosition();
        
        // Recreate materials and rebuild
        const mats = createMaterials(this.vehicleConfig, this.gpuProfile);
        this.dashboardMaterial = mats.dashboard;
        this.leatherMaterial = mats.leather;
        this.metalMaterial = mats.metal;
        this.frameMaterial = mats.frame;
        this.glassMaterial = mats.glass;
        this.mirrorMaterial = mats.mirror;
        this.accentMaterial = mats.accent;
        this.chromeMaterial = mats.chrome;
        this.buildInteriorFromBuilder();
        
        // Update roof state based on vehicle
        if (this.vehicleConfig.hasRoof) {
            this.isRoofOpen = false;
            this.roofTargetY = 1.6;
        } else {
            this.isRoofOpen = true;
            this.roofTargetY = -1.0;
        }
    }

    /**
     * Toggle the convertible roof open/closed.
     * Animates the roof geometry to slide down through the floor.
     */
    public toggleRoof(): void {
        this.isRoofOpen = !this.isRoofOpen;
        this.roofTargetY = this.isRoofOpen ? -1.0 : 1.6;
    }

    /**
     * Update loop - call each frame to animate roof, steering wheel, wipers, and gauges.
     * Includes LOD updates and performance optimizations.
     */

    public update(deltaTime: number): void {

        this.animator.update(deltaTime);
        this.centerDisplay?.update(deltaTime);
        if (this.sunShafts) {
            // interiorGroup.rotation.y is -carHeading (set by the animator).
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

    /**
     * Update gauge needle positions based on speed/RPM.
     * Speed: 0-100 km/h maps to gauge rotation
     * RPM: 0-8000 maps to gauge rotation
     */

    public setActive(active: boolean): void {

        this.animator.setActive(active);

    }

    /**
     * Set the car body orientation (carHeading).
     * The interior stays level with the ground while the head can look freely.
     * When inactive (e.g. freelook mode), pitch and roll are forced to 0.
     * @param carHeading - The car's travel direction in degrees
     */

    public setCarOrientation(carHeading: number, bodyPitch: number = 0, bodyRoll: number = 0): void {

        this.animator.setCarOrientation(carHeading, bodyPitch, bodyRoll);

    }

    /**
     * Set the head/camera orientation for looking around inside the car.
     * This only affects the camera rotation, not the car body.
     * The camera rotates independently while staying at the driver's position.
     * @param headYaw - Yaw angle in degrees (full 360° range) relative to car heading
     * @param headPitch - Pitch angle in degrees (-45 to +65)
     */

    public setHeadOrientation(headYaw: number, headPitch: number): void {

        this.animator.setHeadOrientation(headYaw, headPitch);

    }

    /**
     * Set the steering wheel angle based on car steering input.
     * @param angle - Steering angle in degrees (-90 to +90)
     */

    public setSteeringAngle(angle: number): void {

        this.animator.setSteeringAngle(angle);

    }

    /**
     * Set the active wiper state.
     */

    public setWipersActive(active: boolean): void {

        this.animator.setWipersActive(active);

    }

    /**
     * Update window tint darkness dynamically.
     * @param val - Tint value from 0.0 (clear) to 1.0 (dark)
     */

    public updateWindowTint(val: number): void {

        this.lightingManager.updateWindowTint(val);

    }

    /**
     * Update speedometer and tachometer values.
     * @param speed - Speed in km/h (0-100)
     * @param rpm - RPM (0-8000)
     */

    public setGaugeValues(speed: number, rpm: number): void {

        this.animator.setGaugeValues(speed, rpm);
        this.centerDisplay?.setTelemetry(speed, rpm);

    }

    /**
     * Toggle headlights on/off.
     */

    public toggleHeadlights(): void {

        this.lightingManager.toggleHeadlights();

    }

    /**
     * Get current headlights state.
     */

    public getHeadlightsState(): boolean {

        return this.lightingManager.getHeadlightsState();

    }

    /**
     * Set headlights to a specific state.
     */

    public setHeadlights(on: boolean): void {

        this.lightingManager.setHeadlights(on);

    }

    /** Toggle the dome light on/off. Returns the new state. */

    public toggleDomeLight(): boolean {

        return this.lightingManager.toggleDomeLight();

    }

    /** Get current dome light state. */

    public getDomeLightState(): boolean {

        return this.lightingManager.getDomeLightState();

    }

    /**
     * Set dome light to a specific state.
     */

    public setDomeLight(on: boolean): void {

        this.lightingManager.setDomeLight(on);

    }

    /**
     * Update interior lighting each frame based on headlights + night + dome state.
     * Call this once per animation frame.
     */

    public setInteriorLighting(headlightsOn: boolean, nightIntensity: number, domeLightOn: boolean): void {

        this.lightingManager.setInteriorLighting(headlightsOn, nightIntensity, domeLightOn);
        // Gauge backlight brightens with the same night factor.
        this.animator.setNightFactor(nightIntensity);

    }

    /**
     * Test whether screen coordinates hit the dome light switch mesh.
     */
    public isDomeSwitchHit(clientX: number, clientY: number): boolean {
        if (!this.domeSwitchMesh) return false;
        return this.interaction.hitTest(
            clientX, clientY, this.canvas.getBoundingClientRect(),
            this.camera, this.domeSwitchMesh, false
        );
    }

    /** Update the media page with the current radio station state. */
    public setMediaInfo(name: string, tags: string, playing: boolean): void {
        this.lastMediaInfo = { name, tags, playing };
        this.centerDisplay?.setMedia(name, tags, playing);
    }

    /** Test whether screen coordinates hit the centre display screen. */
    public isCenterDisplayHit(clientX: number, clientY: number): boolean {
        if (!this.centerDisplay) return false;
        return this.interaction.hitTest(
            clientX, clientY, this.canvas.getBoundingClientRect(),
            this.camera, this.centerDisplay.screenMesh, false
        );
    }

    /** Cycle the centre display to its next page. Returns the new page, or null. */
    public cycleDisplayPage(): DisplayPage | null {
        return this.centerDisplay?.cyclePage() ?? null;
    }

    /**
     * Test whether the given screen coordinates intersect the steering wheel geometry.
     * Uses a cached Raycaster to avoid GC churn per click.
     */
    public isSteeringWheelHit(clientX: number, clientY: number): boolean {
        if (!this.steeringWheelGroup) return false;
        return this.interaction.hitTest(
            clientX, clientY, this.canvas.getBoundingClientRect(),
            this.camera, this.steeringWheelGroup, true
        );
    }

    /** Toggle rain droplets on the windshield. */
    public setRainActive(active: boolean): void {
        if (this.rainSystem) this.rainSystem.setActive(active);
    }

    /**
     * 0-1 rain intensity: dims/diffuses the daylight rig, kills the sun
     * shafts, and toggles the windshield droplet system.
     */
    public setWeatherIntensity(rain: number): void {
        this.lightingManager.setWeatherIntensity(rain);
        this.rainSystem?.setActive(rain > 0.02);
    }

    /** Enable/disable post-processing (bloom + SMAA). */

    public setPostProcessingEnabled(enabled: boolean): void {
        this.postProcessingEnabled = enabled;
        this.rendererDelegate.setPostProcessingEnabled(enabled);
    }

    /** Adjust bloom strength (0-1). */

    public setBloomStrength(strength: number): void {

        this.rendererDelegate.setBloomStrength(strength);

    }

    /** Sync Three.js camera FOV with WebGPU shader zoom for window alignment. */
    public setZoomFOV(zoom: number): void {
        this.rendererDelegate.setZoomFOV(zoom);
    }

    /** Position the driver eye anchor from the vehicle config plus the user seat offset. */
    private applySeatPosition(): void {
        const { x, y, z } = this.vehicleConfig.cameraPosition;
        // +Z is toward the rear of the cabin, so a positive offset dollies the eye
        // back away from the wheel/dashboard for a roomier driving posture.
        this.driverSeatGroup.position.set(x, y, z + this.seatOffset);
    }

    /**
     * Set how far back the driver's eye sits from the default position (metres).
     * 0 keeps the per-vehicle config position; larger values pull back off the dash.
     */
    public setSeatOffset(offset: number): void {
        this.seatOffset = offset;
        this.applySeatPosition();
    }

    /** Dump memory stats to the console (dev-only). */

    /** Get current performance metrics (FPS, draw calls, etc.). */

    /** Get formatted performance string for debug overlay. */
    public getPerformanceString(): string {
        return this.profiler?.format() ?? '';
    }

    /**
     * Render the car interior scene.
     * Includes frame rate limiting and frustum culling.
     */

    public render(): void {

        this.rendererDelegate.render();

    }

    /**
     * Clean up resources.
     * Includes memory profiling and proper disposal.
     */
    public dispose(): void {
        cancelAnimationFrame(this.animationId);

        this.centerDisplay?.dispose();
        this.centerDisplay = null;
        this.sunShafts?.dispose();
        this.sunShafts = null;
        this.locationPanel?.dispose();
        this.locationPanel = null;

        // Stop clock update loop
        if (this.clockUpdateInterval !== undefined) {
            clearInterval(this.clockUpdateInterval);
            this.clockUpdateInterval = undefined;
        }
        
        // Log memory stats before disposal
        const memoryProfiler = getMemoryProfiler();
        const stats = memoryProfiler.getStats();
        console.log('[CarInterior] Disposing - memory stats:', {
            geometries: stats.current.geometryCount,
            textures: stats.current.textureCount,
            memory: MemoryProfiler.formatBytes(stats.current.estimatedBytes)
        });
        
        this.renderer.dispose();
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        // Dispose textures first
                        this.disposeMaterialTextures(m);
                        m.dispose();
                    });
                } else {
                    this.disposeMaterialTextures(obj.material);
                    obj.material.dispose();
                }
            }
        });
        
        this.panoEnvironment.dispose();

        // Clear references
        this.locationPanel = null;
        this.detailMeshes = [];
        this.lodUpdateFn = undefined;
        this.geometryFactory.dispose();
        this.lodManager.dispose();
        if (this.postProcessing) this.postProcessing.dispose();
        if (this.rainSystem) this.rainSystem.dispose();
        
        if (this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
    }
    
    /**
     * Dispose textures from a material
     */
    private disposeMaterialTextures(material: THREE.Material): void {
        const mat = material as any;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']
            .forEach(prop => {
                if (mat[prop]) {
                    mat[prop].dispose();
                    mat[prop] = null;
                }
            });
    }
}

