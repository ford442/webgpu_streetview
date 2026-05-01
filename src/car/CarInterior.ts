import * as THREE from 'three';
import { VehicleType, VehicleConfig, getVehicleConfig } from './VehicleManager';
import { 
  setupVehicleInteriorLOD, 
  VehicleLODConfig, 
  FrustumCuller, 
  optimizeTextures,
  GPU_PROFILES,
  applyPerformanceProfile,
  detectGPUProfile
} from '../utils/performance';
import { getMemoryProfiler, MemoryProfiler } from '../utils/memoryProfiler';
import { createGlassMaterial } from '../materials/PBRMaterials';
import { InteractionHelper } from './interior/InteractionHelper';
import { createMaterials } from './interior/MaterialFactory';
import { GeometryFactory } from './interior/GeometryFactory';
import { LODManager } from './interior/LODManager';
import { PostProcessingManager } from './interior/PostProcessingManager';
import { RainSystem } from './interior/RainSystem';
import { buildInteriorLighting } from './interior/LightingBuilder';
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
    private steeringWheelGroup!: THREE.Group;
    private leftMirrorPlane!: THREE.Mesh;
    private rightMirrorPlane!: THREE.Mesh;
    private wiperLeft!: THREE.Group;
    private wiperRight!: THREE.Group;
    private speedometerNeedle!: THREE.Mesh;
    private tachometerNeedle!: THREE.Mesh;
    private headlightsLight!: THREE.SpotLight;
    private domeLightSource!: THREE.PointLight;
    private domeLightFixtureMesh!: THREE.Mesh;
    private domeSwitchMesh!: THREE.Mesh;
    private interiorBounceLight!: THREE.PointLight;
    private ambientLight!: THREE.AmbientLight;
    private hemisphereLight!: THREE.HemisphereLight;
    private overheadLight!: THREE.DirectionalLight;
    private leftWindowLight!: THREE.PointLight;
    private rightWindowLight!: THREE.PointLight;
    private instrumentClusterMat!: THREE.MeshStandardMaterial;
    private centerDisplayMat!: THREE.MeshStandardMaterial;
    private windshieldGlassMesh!: THREE.Mesh;
    private rearGlassMesh!: THREE.Mesh;
    private isDomeLightOn: boolean = false;

    // Digital Clock
    private digitalClockMesh!: THREE.Mesh;
    private clockCanvas!: HTMLCanvasElement;
    private clockCtx!: CanvasRenderingContext2D;
    private clockUpdateInterval?: number;
    private clockColonVisible: boolean = true;
    private isActive: boolean = true;

    private isRoofOpen: boolean = false;
    private roofTargetY: number = 0;
    private animationId: number = 0;
    private steeringAngle: number = 0;
    private wiperAnimationTime: number = 0;
    private isWiperActive: boolean = false;
    private speedometer: number = 0; // 0-100 km/h
    private tachometer: number = 0; // 0-8000 RPM
    private nightIntensity: number = 0;
    private interaction: InteractionHelper;
    private reducedMotion: boolean;
    private geometryFactory: GeometryFactory;
    private lodManager: LODManager;
    private postProcessing?: PostProcessingManager;
    private rainSystem?: RainSystem;
    private postProcessingEnabled = true;
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

    // Performance optimization
    private lodUpdateFn?: () => void;
    private frustumCuller: FrustumCuller;
    private lodConfig: VehicleLODConfig;
    private detailMeshes: THREE.Mesh[] = [];
    private lastRenderTime: number = 0;
    private renderInterval: number = 16.67; // Target 60fps
    private quality: 'high' | 'medium' | 'low' = 'high';
    private gpuProfile = detectGPUProfile();

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
        const { x, y, z } = this.vehicleConfig.cameraPosition;
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
        this.renderer.autoClear = false;
        
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
        this.driverSeatGroup.position.set(x, y, z);
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
        const lights = buildInteriorLighting(this.scene, this.interiorGroup, this.renderer, this.vehicleConfig);
        this.hemisphereLight = lights.hemisphereLight;
        this.ambientLight = lights.ambientLight;
        this.overheadLight = lights.overheadLight;
        this.leftWindowLight = lights.leftWindowLight;
        this.rightWindowLight = lights.rightWindowLight;
        this.headlightsLight = lights.headlightsLight;
        this.interiorBounceLight = lights.interiorBounceLight;
        this.domeLightSource = lights.domeLightSource;
        this.buildInterior();
        
        // Setup LOD after building interior
        this.setupLOD();
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
    public setQuality(quality: 'high' | 'medium' | 'low'): void {
        if (this.quality === quality) return;
        this.quality = quality;
        
        const profile = GPU_PROFILES[quality];
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.pixelRatio));
        
        // Update LOD config based on quality
        this.lodConfig = {
            dashboardLOD: quality !== 'low',
            seatLOD: quality !== 'low',
            interiorDetails: quality === 'high'
        };
        
        // Re-setup LOD with new config
        this.lodUpdateFn = setupVehicleInteriorLOD(
            this.interiorGroup, 
            this.camera, 
            this.lodConfig
        );
        
        console.log('[CarInterior] Quality set to:', quality);
    }

    /**
     * Get current quality level
     */
    public getQuality(): 'high' | 'medium' | 'low' {
        return this.quality;
    }

    private buildInterior(): void {
        // Build components based on vehicle configuration
        if (this.vehicleConfig.hasDashboard) {
            this.buildDashboard();
        }
        
        if (this.vehicleConfig.hasSteeringWheel) {
            this.buildSteeringWheel();
        }
        
        this.buildDoorPanels();
        this.buildSeats();
        this.buildFloor();
        this.buildFloorMats();
        
        if (this.vehicleConfig.hasRoof) {
            this.buildRoof();
        }
        
        this.buildWindshieldFrame();
        this.buildWindshieldGlass();
        this.buildRearWindow();
        
        if (this.vehicleConfig.hasSideMirrors) {
            this.buildSideMirrors();
        }
        
        if (this.vehicleConfig.hasWipers) {
            this.buildWipers();
        }
        
        if (this.vehicleConfig.hasGauges) {
            this.buildGauges();
        }

        // Digital clock (medium + high quality only)
        if (this.quality !== 'low') {
            this.buildDigitalClock();
        }

        // Build vehicle-specific features
        this.buildVehicleSpecificFeatures();

        // Dome light fixture (ceiling mount + clickable switch)
        this.buildDomeLightFixture();
    }

    /**
     * Build vehicle-specific interior features
     */
    private buildVehicleSpecificFeatures(): void {
        switch (this.vehicleConfig.type) {
            case 'science-lab':
                this.buildLabFeatures();
                break;
            case 'limousine':
                this.buildLimoFeatures();
                break;
            case 'convertible':
                this.buildConvertibleFeatures();
                break;
            default:
                // Sedan uses default layout
                break;
        }
    }

    private buildDomeLightFixture(): void {
        // Check if roofGroup is available (convertible may not have it)
        const mountGroup = this.roofGroup ?? this.interiorGroup;

        const fixtureGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.015, 12);
        const fixtureMat = new THREE.MeshStandardMaterial({
            color: 0xddddcc, emissive: 0xFFE8B0, emissiveIntensity: 0,
            roughness: 0.4, metalness: 0.3,
        });
        this.domeLightFixtureMesh = new THREE.Mesh(fixtureGeo, fixtureMat);
        this.domeLightFixtureMesh.position.set(0, 1.59, 0.3);
        mountGroup.add(this.domeLightFixtureMesh);

        const switchGeo = new THREE.BoxGeometry(0.04, 0.008, 0.04);
        const switchMat = new THREE.MeshStandardMaterial({
            color: 0x333333, roughness: 0.7, metalness: 0.1,
            emissive: 0x111100, emissiveIntensity: 0,
        });
        this.domeSwitchMesh = new THREE.Mesh(switchGeo, switchMat);
        this.domeSwitchMesh.name = 'domeSwitch';
        this.domeSwitchMesh.position.set(-0.15, 1.55, -0.1);
        this.interiorGroup.add(this.domeSwitchMesh);
    }

    /**
     * Build science lab specific features (monitors, equipment)
     */
    private buildLabFeatures(): void {
        // Lab monitors on dashboard
        const monitorGeo = new THREE.BoxGeometry(0.4, 0.25, 0.05);
        const monitorMat = new THREE.MeshStandardMaterial({
            color: 0x000000,
            emissive: 0x004444,
            emissiveIntensity: 0.5,
            roughness: 0.2,
        });
        
        const monitor1 = new THREE.Mesh(monitorGeo, monitorMat);
        monitor1.position.set(0.2, 1.0, -0.72);
        this.interiorGroup.add(monitor1);

        const monitor2 = new THREE.Mesh(monitorGeo, monitorMat);
        monitor2.position.set(-0.2, 1.0, -0.72);
        this.interiorGroup.add(monitor2);

        // Equipment racks behind seats
        const rackGeo = new THREE.BoxGeometry(1.8, 0.6, 0.3);
        const rackMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.4,
            metalness: 0.7,
        });
        const rack = new THREE.Mesh(rackGeo, rackMat);
        rack.position.set(0, 1.0, 0.8);
        this.interiorGroup.add(rack);
    }

    /**
     * Build limousine specific features (mini bar, extended space)
     */
    private buildLimoFeatures(): void {
        // Mini bar console between front seats
        const barGeo = new THREE.BoxGeometry(0.25, 0.4, 0.6);
        const barMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.3,
            metalness: 0.5,
        });
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.set(0, 0.65, 0.4);
        this.interiorGroup.add(bar);

        // Glass holders
        for (let i = 0; i < 3; i++) {
            const holderGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8);
            const holderMat = new THREE.MeshStandardMaterial({
                color: 0xc0c0c0,
                roughness: 0.2,
                metalness: 0.9,
            });
            const holder = new THREE.Mesh(holderGeo, holderMat);
            holder.position.set(-0.08 + i * 0.08, 0.9, 0.5);
            this.interiorGroup.add(holder);
        }

        // Privacy divider hint
        const dividerGeo = new THREE.BoxGeometry(1.6, 0.05, 0.02);
        const dividerMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.1,
            metalness: 0.1,
        });
        const divider = new THREE.Mesh(dividerGeo, dividerMat);
        divider.position.set(0, 1.4, 0.6);
        this.interiorGroup.add(divider);
    }

    /**
     * Build convertible specific features
     */
    private buildConvertibleFeatures(): void {
        // Wind deflector behind seats
        const deflectorGeo = new THREE.BoxGeometry(1.4, 0.3, 0.02);
        const deflectorMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            transparent: true,
            opacity: 0.7,
            roughness: 0.1,
        });
        const deflector = new THREE.Mesh(deflectorGeo, deflectorMat);
        deflector.position.set(0, 1.2, 0.5);
        deflector.rotation.set(-0.2, 0, 0);
        this.interiorGroup.add(deflector);

        // Sport seats (smaller headrests)
        const sportHeadrestGeo = new THREE.BoxGeometry(0.18, 0.15, 0.06);
        const headrest = new THREE.Mesh(sportHeadrestGeo, this.leatherMaterial);
        headrest.position.set(-0.35, 1.3, 0.5);
        this.interiorGroup.add(headrest);
    }

    private buildDashboard(): void {
        // Main dashboard body
        const dashGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
        const dash = new THREE.Mesh(dashGeo, this.dashboardMaterial);
        dash.position.set(0, 0.8, -1.0);
        this.interiorGroup.add(dash);

        // Dashboard top curve (slightly beveled)
        const dashTopGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 8, 1, false, 0, Math.PI);
        const dashTop = new THREE.Mesh(dashTopGeo, this.dashboardMaterial);
        dashTop.rotation.set(0, 0, Math.PI / 2);
        dashTop.position.set(0, 1.0, -0.85);
        this.interiorGroup.add(dashTop);

        // Instrument cluster recess
        const clusterGeo = new THREE.BoxGeometry(0.6, 0.25, 0.05);
        const clusterMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x001100, emissiveIntensity: 0.5 });
        this.instrumentClusterMat = clusterMat;
        const cluster = new THREE.Mesh(clusterGeo, clusterMat);
        cluster.position.set(-0.3, 0.95, -0.74);
        this.interiorGroup.add(cluster);

        // Center console display
        const displayGeo = new THREE.BoxGeometry(0.3, 0.2, 0.02);
        const displayMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x002200, emissiveIntensity: 0.3 });
        this.centerDisplayMat = displayMat;
        const display = new THREE.Mesh(displayGeo, displayMat);
        display.position.set(0.15, 0.95, -0.74);
        this.interiorGroup.add(display);

        // Accent trim strip along top dashboard edge (vehicle theme color)
        if (this.quality !== 'low') {
            const accentHex = parseInt(this.vehicleConfig.accentColor.replace('#', '0x'));
            const trimGeo = new THREE.BoxGeometry(1.96, 0.008, 0.012);
            const trimMat = new THREE.MeshStandardMaterial({
                color: accentHex,
                roughness: 0.3,
                metalness: 0.7,
                emissive: new THREE.Color(accentHex),
                emissiveIntensity: 0.15,
            });
            const trim = new THREE.Mesh(trimGeo, trimMat);
            trim.position.set(0, 1.005, -0.86);
            this.interiorGroup.add(trim);

            // Subtle lower dash accent rail
            const lowerTrimGeo = new THREE.BoxGeometry(1.96, 0.006, 0.01);
            const lowerTrim = new THREE.Mesh(lowerTrimGeo, trimMat);
            lowerTrim.position.set(0, 0.625, -0.99);
            this.interiorGroup.add(lowerTrim);

            // Cluster bezel ring (glowing ring around instrument cluster)
            const bezelRingGeo = new THREE.TorusGeometry(0.155, 0.008, 8, 32);
            const bezelRingMat = new THREE.MeshStandardMaterial({
                color: accentHex,
                roughness: 0.2,
                metalness: 0.8,
                emissive: new THREE.Color(accentHex),
                emissiveIntensity: 0.4,
            });
            const bezelRing = new THREE.Mesh(bezelRingGeo, bezelRingMat);
            bezelRing.position.set(-0.3, 0.95, -0.73);
            this.interiorGroup.add(bezelRing);
        }

        // Add dashboard details (skip in low quality)
        if (this.quality !== 'low') {
            this.buildDashboardDetails();
        }
    }

    /**
     * Build dashboard details: air vents, HVAC controls, buttons
     */
    private buildDashboardDetails(): void {
        const gf = this.geometryFactory;

        // Chrome/metallic material for accents
        const chromeMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.15,
            metalness: 0.9,
        });

        // Air vents (left and right)
        const ventGeo = gf.getBox(0.12, 0.08, 0.03);
        const ventMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

        const leftVent = new THREE.Mesh(ventGeo, ventMat);
        leftVent.position.set(-0.7, 0.95, -0.74);
        this.interiorGroup.add(leftVent);

        const ventSurroundGeo = gf.getBox(0.14, 0.1, 0.02);
        const leftVentSurround = new THREE.Mesh(ventSurroundGeo, chromeMaterial);
        leftVentSurround.position.set(-0.7, 0.95, -0.735);
        this.interiorGroup.add(leftVentSurround);

        const rightVent = new THREE.Mesh(ventGeo, ventMat);
        rightVent.position.set(0.7, 0.95, -0.74);
        this.interiorGroup.add(rightVent);

        const rightVentSurround = new THREE.Mesh(ventSurroundGeo, chromeMaterial);
        rightVentSurround.position.set(0.7, 0.95, -0.735);
        this.interiorGroup.add(rightVentSurround);

        const centerVent = new THREE.Mesh(gf.getBox(0.15, 0.06, 0.03), ventMat);
        centerVent.position.set(0.55, 0.95, -0.74);
        this.interiorGroup.add(centerVent);

        // HVAC Control Knobs — batched via InstancedMesh for fewer draw calls
        const knobGeo = gf.getCylinder(0.025, 0.025, 0.015, 16);
        const knobMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.4,
            metalness: 0.3,
        });
        this.lodManager.registerBatch('knobs', knobGeo, knobMat, 3);
        const knobBatch = this.lodManager.getBatch('knobs')!;
        this.interiorGroup.add(knobBatch);

        const indicatorGeo = gf.getBox(0.015, 0.002, 0.008);
        const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.lodManager.registerBatch('indicators', indicatorGeo, indicatorMat, 3);
        const indicatorBatch = this.lodManager.getBatch('indicators')!;
        this.interiorGroup.add(indicatorBatch);

        const dummy = new THREE.Object3D();
        for (let i = 0; i < 3; i++) {
            dummy.position.set(0.45 + i * 0.06, 0.85, -0.72);
            dummy.updateMatrix();
            this.lodManager.addInstance('knobs', dummy.matrix);

            dummy.position.set(0.45 + i * 0.06, 0.85, -0.715);
            dummy.updateMatrix();
            this.lodManager.addInstance('indicators', dummy.matrix);
        }
        this.lodManager.finalize();

        // Hazard light button (center, red, prominent)
        const hazardGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.008, 16);
        const hazardMat = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0x330000,
            emissiveIntensity: 0.3,
            roughness: 0.3,
        });
        const hazardBtn = new THREE.Mesh(hazardGeo, hazardMat);
        hazardBtn.position.set(0.35, 0.85, -0.72);
        this.interiorGroup.add(hazardBtn);

        // Hazard symbol (triangle)
        const hazardSymbolGeo = new THREE.ConeGeometry(0.008, 0.012, 3);
        const hazardSymbolMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const hazardSymbol = new THREE.Mesh(hazardSymbolGeo, hazardSymbolMat);
        hazardSymbol.rotation.x = Math.PI;
        hazardSymbol.position.set(0.35, 0.85, -0.715);
        this.interiorGroup.add(hazardSymbol);

        // Dashboard buttons array (below display)
        const btnGeo = new THREE.BoxGeometry(0.03, 0.015, 0.005);
        const btnMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 });
        
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 4; col++) {
                const btn = new THREE.Mesh(btnGeo, btnMat);
                btn.position.set(0.05 + col * 0.035, 0.82 - row * 0.02, -0.72);
                this.interiorGroup.add(btn);
            }
        }

        // Start/Stop button (driver side, prominent)
        const startBtnGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.01, 16);
        const startBtnMat = new THREE.MeshStandardMaterial({
            color: 0xcc0000,
            emissive: 0x220000,
            emissiveIntensity: 0.2,
            roughness: 0.3,
            metalness: 0.4,
        });
        const startBtn = new THREE.Mesh(startBtnGeo, startBtnMat);
        startBtn.position.set(-0.15, 0.88, -0.72);
        this.interiorGroup.add(startBtn);

        // Start button chrome ring
        const startRingGeo = new THREE.TorusGeometry(0.02, 0.003, 8, 24);
        const startRing = new THREE.Mesh(startRingGeo, chromeMaterial);
        startRing.position.set(-0.15, 0.88, -0.715);
        this.interiorGroup.add(startRing);
    }

    private buildSteeringWheel(): void {
        // Create steering wheel group for rotation animation
        this.steeringWheelGroup = new THREE.Group();
        this.steeringWheelGroup.position.set(-0.35, 0.95, -0.6);
        this.interiorGroup.add(this.steeringWheelGroup);

        // Dark leather material for the rim — more realistic than the generic frame plastic
        const wheelRimMat = new THREE.MeshStandardMaterial({
            color: 0x0e0a06,
            roughness: 0.62,
            metalness: 0.04,
            envMapIntensity: 0.3,
            side: THREE.DoubleSide,
        });

        // Steering wheel rim — more radial segments (12) and tube segments (32) for a
        // smoother, rounder silhouette, and slightly thicker tube for a grippy hand-feel.
        const wheelGeo = new THREE.TorusGeometry(0.18, 0.022, 12, 32);
        const wheel = new THREE.Mesh(wheelGeo, wheelRimMat);
        wheel.rotation.set(Math.PI * 0.35, 0, 0);
        this.steeringWheelGroup.add(wheel);

        // Steering wheel center hub
        const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16);
        const hub = new THREE.Mesh(hubGeo, this.dashboardMaterial);
        hub.rotation.set(Math.PI * 0.35, 0, 0);
        this.steeringWheelGroup.add(hub);

        // Spokes (3 spokes) - attach to rotating wheel
        for (let i = 0; i < 3; i++) {
            const spokeGeo = new THREE.BoxGeometry(0.015, 0.16, 0.015);
            const spoke = new THREE.Mesh(spokeGeo, this.metalMaterial);
            const angle = (i * Math.PI * 2) / 3 + Math.PI * 0.35;
            spoke.position.set(Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0);
            spoke.rotation.set(Math.PI * 0.35, 0, angle);
            this.steeringWheelGroup.add(spoke);
        }

        // Steering column (separate from wheel group for aesthetic)
        const columnGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8);
        const column = new THREE.Mesh(columnGeo, this.metalMaterial);
        column.position.set(-0.35, 0.78, -0.7);
        column.rotation.set(Math.PI * 0.35, 0, 0);
        this.interiorGroup.add(column);
    }

    private buildDoorPanels(): void {
        // Left door panel (driver side)
        const leftDoorGeo = new THREE.BoxGeometry(0.08, 0.6, 1.8);
        const leftDoor = new THREE.Mesh(leftDoorGeo, this.frameMaterial);
        leftDoor.position.set(-1.0, 0.7, 0.0);
        this.interiorGroup.add(leftDoor);

        // Left door armrest
        const leftArmGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const leftArm = new THREE.Mesh(leftArmGeo, this.leatherMaterial);
        leftArm.position.set(-0.96, 0.85, 0.1);
        this.interiorGroup.add(leftArm);

        // Right door panel (passenger side)
        const rightDoorGeo = new THREE.BoxGeometry(0.08, 0.6, 1.8);
        const rightDoor = new THREE.Mesh(rightDoorGeo, this.frameMaterial);
        rightDoor.position.set(1.0, 0.7, 0.0);
        this.interiorGroup.add(rightDoor);

        // Right door armrest
        const rightArmGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const rightArm = new THREE.Mesh(rightArmGeo, this.leatherMaterial);
        rightArm.position.set(0.96, 0.85, 0.1);
        this.interiorGroup.add(rightArm);

        // Center console between seats
        const consoleGeo = new THREE.BoxGeometry(0.3, 0.35, 0.8);
        const consoleMesh = new THREE.Mesh(consoleGeo, this.dashboardMaterial);
        consoleMesh.position.set(0.0, 0.55, 0.3);
        this.interiorGroup.add(consoleMesh);

        // Add door details (skip in low quality)
        if (this.quality !== 'low') {
            this.buildDoorPanelDetails();
        }
    }

    /**
     * Build door panel details: speaker grilles, handles, window controls
     */
    private buildDoorPanelDetails(): void {
        const gf = this.geometryFactory;

        const chromeMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.15,
            metalness: 0.9,
        });

        const softTouchMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.7,
            metalness: 0.0,
        });

        const grilleMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.9,
        });

        // Speakers — use shared geometry from factory
        const speakerGeo = gf.getCircle(0.08, 32);
        const leftSpeaker = new THREE.Mesh(speakerGeo, grilleMat);
        leftSpeaker.position.set(-0.96, 0.55, 0.6);
        leftSpeaker.rotation.y = Math.PI / 2;
        this.interiorGroup.add(leftSpeaker);

        for (let i = 1; i <= 3; i++) {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.015 * i, 0.015 * i + 0.005, 32),
                new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
            );
            ring.position.set(-0.955, 0.55, 0.6);
            ring.rotation.y = Math.PI / 2;
            this.interiorGroup.add(ring);
            this.lodManager.registerDetail(ring as THREE.Mesh);
        }

        const rightSpeaker = new THREE.Mesh(speakerGeo, grilleMat);
        rightSpeaker.position.set(0.96, 0.55, 0.6);
        rightSpeaker.rotation.y = -Math.PI / 2;
        this.interiorGroup.add(rightSpeaker);

        for (let i = 1; i <= 3; i++) {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.015 * i, 0.015 * i + 0.005, 32),
                new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
            );
            ring.position.set(0.955, 0.55, 0.6);
            ring.rotation.y = -Math.PI / 2;
            this.interiorGroup.add(ring);
            this.lodManager.registerDetail(ring as THREE.Mesh);
        }

        // Door handles
        const handleGeo = gf.getBox(0.04, 0.015, 0.08);
        const leftHandle = new THREE.Mesh(handleGeo, chromeMaterial);
        leftHandle.position.set(-0.96, 0.92, -0.4);
        this.interiorGroup.add(leftHandle);

        const handleRecessGeo = gf.getBox(0.03, 0.04, 0.1);
        const leftHandleRecess = new THREE.Mesh(handleRecessGeo, softTouchMat);
        leftHandleRecess.position.set(-0.96, 0.9, -0.4);
        this.interiorGroup.add(leftHandleRecess);

        const rightHandle = new THREE.Mesh(handleGeo, chromeMaterial);
        rightHandle.position.set(0.96, 0.92, -0.4);
        this.interiorGroup.add(rightHandle);

        const rightHandleRecess = new THREE.Mesh(handleRecessGeo, softTouchMat);
        rightHandleRecess.position.set(0.96, 0.9, -0.4);
        this.interiorGroup.add(rightHandleRecess);

        // Window switch panels
        const switchPanelGeo = gf.getBox(0.03, 0.08, 0.15);
        const switchPanelMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const leftSwitchPanel = new THREE.Mesh(switchPanelGeo, switchPanelMat);
        leftSwitchPanel.position.set(-0.96, 0.85, -0.2);
        this.interiorGroup.add(leftSwitchPanel);

        // Window switches — batched via InstancedMesh
        const switchBtnGeo = gf.getBox(0.008, 0.015, 0.02);
        const switchBtnMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
        this.lodManager.registerBatch('windowSwitches', switchBtnGeo, switchBtnMat, 8);
        const switchBatch = this.lodManager.getBatch('windowSwitches')!;
        this.interiorGroup.add(switchBatch);

        const dummy = new THREE.Object3D();
        for (let i = 0; i < 4; i++) {
            dummy.position.set(-0.945, 0.87 - i * 0.018, -0.2);
            dummy.updateMatrix();
            this.lodManager.addInstance('windowSwitches', dummy.matrix);
        }

        const rightSwitchPanel = new THREE.Mesh(switchPanelGeo, switchPanelMat);
        rightSwitchPanel.position.set(0.96, 0.85, -0.2);
        this.interiorGroup.add(rightSwitchPanel);

        dummy.position.set(0.945, 0.87, -0.2);
        dummy.updateMatrix();
        this.lodManager.addInstance('windowSwitches', dummy.matrix);
        this.lodManager.finalize();

        // Door panel soft-touch inserts (upper section)
        const insertGeo = new THREE.BoxGeometry(0.04, 0.25, 0.6);
        const leftInsert = new THREE.Mesh(insertGeo, softTouchMat);
        leftInsert.position.set(-0.96, 0.95, 0.2);
        this.interiorGroup.add(leftInsert);

        const rightInsert = new THREE.Mesh(insertGeo, softTouchMat);
        rightInsert.position.set(0.96, 0.95, 0.2);
        this.interiorGroup.add(rightInsert);
    }

    private buildSeats(): void {
        const gf = this.geometryFactory;
        const seatBackGeo = gf.getBox(0.5, 0.7, 0.12);
        const seatBottomGeo = gf.getBox(0.5, 0.1, 0.5);
        const headrestGeo = gf.getBox(0.2, 0.2, 0.08);

        const seatBack = new THREE.Mesh(seatBackGeo, this.leatherMaterial);
        seatBack.position.set(-0.35, 0.9, 0.5);
        seatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(seatBack);

        const seatBottom = new THREE.Mesh(seatBottomGeo, this.leatherMaterial);
        seatBottom.position.set(-0.35, 0.5, 0.2);
        this.interiorGroup.add(seatBottom);

        const passSeatBack = new THREE.Mesh(seatBackGeo, this.leatherMaterial);
        passSeatBack.position.set(0.45, 0.9, 0.5);
        passSeatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(passSeatBack);

        const passSeatBottom = new THREE.Mesh(seatBottomGeo, this.leatherMaterial);
        passSeatBottom.position.set(0.45, 0.5, 0.2);
        this.interiorGroup.add(passSeatBottom);

        const headrest = new THREE.Mesh(headrestGeo, this.leatherMaterial);
        headrest.position.set(-0.35, 1.35, 0.5);
        this.interiorGroup.add(headrest);

        const headrestPass = new THREE.Mesh(headrestGeo, this.leatherMaterial);
        headrestPass.position.set(0.45, 1.35, 0.5);
        this.interiorGroup.add(headrestPass);

        // Headrest stalks (metal posts connecting headrests to seatbacks)
        const stalkGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6);
        for (const x of [-0.35, 0.45]) {
            for (const offset of [-0.05, 0.05]) {
                const stalk = new THREE.Mesh(stalkGeo, this.metalMaterial);
                stalk.position.set(x + offset, 1.22, 0.52);
                this.interiorGroup.add(stalk);
            }
        }

        // Seatbelt shoulder anchors (B-pillar mount points)
        const anchorGeo = new THREE.BoxGeometry(0.035, 0.05, 0.015);
        const anchorMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.35,
            metalness: 0.85,
        });
        // Driver side
        const driverAnchor = new THREE.Mesh(anchorGeo, anchorMat);
        driverAnchor.position.set(-0.6, 1.25, 0.45);
        this.interiorGroup.add(driverAnchor);
        // Passenger side
        const passAnchor = new THREE.Mesh(anchorGeo, anchorMat);
        passAnchor.position.set(0.7, 1.25, 0.45);
        this.interiorGroup.add(passAnchor);

        // Add seat stitching and side bolsters (skip in low quality)
        if (this.quality !== 'low') {
            this.buildSeatDetails();
        }
    }

    /**
     * Build seat details: diamond stitching patterns and side bolsters
     * Adds premium leather seat appearance
     */
    private buildSeatDetails(): void {
        // Create diamond quilted pattern for center seat panels — lighter leather with
        // env map response for subtle specular on the raised diamonds.
        const stitchMaterial = new THREE.MeshStandardMaterial({
            color: 0x9B5523, // Slightly lighter leather
            roughness: 0.58,
            metalness: 0.0,
            envMapIntensity: 0.3,
        });

        // Driver seat center panel with diamond stitching
        const driverCenterGeo = new THREE.PlaneGeometry(0.22, 0.45, 5, 9);
        const pos = driverCenterGeo.attributes.position;
        // Create diamond pattern by raising vertices
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            // Diamond pattern: every other vertex raised
            const diamond = (Math.floor((x + 0.11) / 0.044) + Math.floor((y + 0.225) / 0.05)) % 2 === 0;
            if (diamond) {
                pos.setZ(i, 0.008);
            }
        }
        driverCenterGeo.computeVertexNormals();

        const driverCenter = new THREE.Mesh(driverCenterGeo, stitchMaterial);
        driverCenter.position.set(-0.35, 0.9, 0.565);
        driverCenter.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(driverCenter);

        // Driver seat bottom center panel
        const driverBottomCenterGeo = new THREE.PlaneGeometry(0.22, 0.35, 5, 7);
        const posB = driverBottomCenterGeo.attributes.position;
        for (let i = 0; i < posB.count; i++) {
            const x = posB.getX(i);
            const y = posB.getY(i);
            const diamond = (Math.floor((x + 0.11) / 0.044) + Math.floor((y + 0.175) / 0.05)) % 2 === 0;
            if (diamond) {
                posB.setZ(i, 0.008);
            }
        }
        driverBottomCenterGeo.computeVertexNormals();

        const driverBottomCenter = new THREE.Mesh(driverBottomCenterGeo, stitchMaterial);
        driverBottomCenter.position.set(-0.35, 0.56, 0.23);
        driverBottomCenter.rotation.x = -Math.PI / 2;
        this.interiorGroup.add(driverBottomCenter);

        // Passenger seat center panels (mirrored)
        const passCenterGeo = new THREE.PlaneGeometry(0.22, 0.45, 5, 9);
        const posP = passCenterGeo.attributes.position;
        for (let i = 0; i < posP.count; i++) {
            const x = posP.getX(i);
            const y = posP.getY(i);
            const diamond = (Math.floor((x + 0.11) / 0.044) + Math.floor((y + 0.225) / 0.05)) % 2 === 0;
            if (diamond) {
                posP.setZ(i, 0.008);
            }
        }
        passCenterGeo.computeVertexNormals();

        const passCenter = new THREE.Mesh(passCenterGeo, stitchMaterial);
        passCenter.position.set(0.45, 0.9, 0.565);
        passCenter.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(passCenter);

        const passBottomCenterGeo = new THREE.PlaneGeometry(0.22, 0.35, 5, 7);
        const posPB = passBottomCenterGeo.attributes.position;
        for (let i = 0; i < posPB.count; i++) {
            const x = posPB.getX(i);
            const y = posPB.getY(i);
            const diamond = (Math.floor((x + 0.11) / 0.044) + Math.floor((y + 0.175) / 0.05)) % 2 === 0;
            if (diamond) {
                posPB.setZ(i, 0.008);
            }
        }
        passBottomCenterGeo.computeVertexNormals();

        const passBottomCenter = new THREE.Mesh(passBottomCenterGeo, stitchMaterial);
        passBottomCenter.position.set(0.45, 0.56, 0.23);
        passBottomCenter.rotation.x = -Math.PI / 2;
        this.interiorGroup.add(passBottomCenter);

        // Side bolsters for sportier look — use a richer leather material with env map
        const bolsterMaterial = new THREE.MeshStandardMaterial({
            color: 0x7B4010,
            roughness: 0.70,
            metalness: 0.0,
            envMapIntensity: 0.25,
        });

        // Driver side bolsters
        const leftBolsterGeo = new THREE.BoxGeometry(0.08, 0.5, 0.08);
        const leftBolster = new THREE.Mesh(leftBolsterGeo, bolsterMaterial);
        leftBolster.position.set(-0.58, 0.9, 0.52);
        leftBolster.rotation.set(-0.15, 0.1, 0);
        this.interiorGroup.add(leftBolster);

        const rightBolsterGeo = new THREE.BoxGeometry(0.08, 0.5, 0.08);
        const rightBolster = new THREE.Mesh(rightBolsterGeo, bolsterMaterial);
        rightBolster.position.set(-0.12, 0.9, 0.52);
        rightBolster.rotation.set(-0.15, -0.1, 0);
        this.interiorGroup.add(rightBolster);

        // Passenger side bolsters
        const leftBolsterP = new THREE.Mesh(leftBolsterGeo, bolsterMaterial);
        leftBolsterP.position.set(0.22, 0.9, 0.52);
        leftBolsterP.rotation.set(-0.15, 0.1, 0);
        this.interiorGroup.add(leftBolsterP);

        const rightBolsterP = new THREE.Mesh(rightBolsterGeo, bolsterMaterial);
        rightBolsterP.position.set(0.68, 0.9, 0.52);
        rightBolsterP.rotation.set(-0.15, -0.1, 0);
        this.interiorGroup.add(rightBolsterP);
    }

    private buildFloor(): void {
        const floorGeo = new THREE.PlaneGeometry(2.0, 2.5);
        // Dark carpet floor — high roughness, zero metalness, slight env response
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x141414,
            roughness: 0.97,
            metalness: 0.0,
            envMapIntensity: 0.05,
            side: THREE.DoubleSide,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.set(-Math.PI / 2, 0, 0);
        floor.position.set(0, 0.35, 0);
        this.interiorGroup.add(floor);
    }

    /**
     * Build floor mats for driver and passenger
     * Adds rubber/carpet mats with raised edges
     */
    private buildFloorMats(): void {
        // Skip floor mats in low quality mode
        if (this.quality === 'low') return;

        const matMaterial = new THREE.MeshStandardMaterial({
            color: 0x1f1f1f,
            roughness: 0.85,
            metalness: 0.0,
        });

        // Driver floor mat - curved shape using Shape/Extrude
        const driverMatShape = new THREE.Shape();
        driverMatShape.moveTo(-0.42, 0.05);
        driverMatShape.lineTo(0.08, 0.05);
        driverMatShape.lineTo(0.12, 0.55);
        driverMatShape.quadraticCurveTo(0.1, 0.7, -0.1, 0.72);
        driverMatShape.lineTo(-0.38, 0.72);
        driverMatShape.quadraticCurveTo(-0.45, 0.4, -0.42, 0.05);

        const driverMatGeo = new THREE.ExtrudeGeometry(driverMatShape, {
            depth: 0.008,
            bevelEnabled: true,
            bevelThickness: 0.004,
            bevelSize: 0.004,
            bevelSegments: 2,
        });

        const driverMat = new THREE.Mesh(driverMatGeo, matMaterial);
        driverMat.rotation.x = -Math.PI / 2;
        driverMat.position.set(-0.35, 0.355, 0.15);
        this.interiorGroup.add(driverMat);

        // Passenger floor mat
        const passMatShape = new THREE.Shape();
        passMatShape.moveTo(0.42, 0.05);
        passMatShape.lineTo(-0.08, 0.05);
        passMatShape.lineTo(-0.12, 0.55);
        passMatShape.quadraticCurveTo(-0.1, 0.7, 0.1, 0.72);
        passMatShape.lineTo(0.38, 0.72);
        passMatShape.quadraticCurveTo(0.45, 0.4, 0.42, 0.05);

        const passMatGeo = new THREE.ExtrudeGeometry(passMatShape, {
            depth: 0.008,
            bevelEnabled: true,
            bevelThickness: 0.004,
            bevelSize: 0.004,
            bevelSegments: 2,
        });

        const passMat = new THREE.Mesh(passMatGeo, matMaterial);
        passMat.rotation.x = -Math.PI / 2;
        passMat.position.set(0.35, 0.355, 0.15);
        this.interiorGroup.add(passMat);
    }

    private buildRoof(): void {
        // Convertible roof - can be toggled open/closed
        const roofGeo = new THREE.BoxGeometry(2.0, 0.05, 2.0);
        const roofMat = new THREE.MeshStandardMaterial({
            color: 0x1e1e1e,
            roughness: 0.88,
            metalness: 0.02,
            envMapIntensity: 0.1,
            side: THREE.DoubleSide,
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(0, 1.6, 0);
        this.roofGroup.add(roof);
    }

    private buildWindshieldFrame(): void {
        // A-pillars (windshield frame)
        const pillarGeo = new THREE.BoxGeometry(0.06, 0.8, 0.06);

        // Left A-pillar
        const leftPillar = new THREE.Mesh(pillarGeo, this.frameMaterial);
        leftPillar.position.set(-0.95, 1.3, -0.85);
        leftPillar.rotation.set(-0.2, 0, -0.1);
        this.interiorGroup.add(leftPillar);

        // Right A-pillar
        const rightPillar = new THREE.Mesh(pillarGeo, this.frameMaterial);
        rightPillar.position.set(0.95, 1.3, -0.85);
        rightPillar.rotation.set(-0.2, 0, 0.1);
        this.interiorGroup.add(rightPillar);

        // Windshield top bar
        const topBarGeo = new THREE.BoxGeometry(1.95, 0.06, 0.06);
        const topBar = new THREE.Mesh(topBarGeo, this.frameMaterial);
        topBar.position.set(0, 1.6, -0.9);
        this.interiorGroup.add(topBar);

        // Rubber weather-strip seals along A-pillars (dark matte rubber)
        if (this.quality !== 'low') {
            const rubberMat = new THREE.MeshStandardMaterial({
                color: 0x0a0a0a,
                roughness: 0.98,
                metalness: 0.0,
            });
            const sealGeo = new THREE.BoxGeometry(0.016, 0.78, 0.016);

            const leftSeal = new THREE.Mesh(sealGeo, rubberMat);
            leftSeal.position.set(-0.922, 1.3, -0.87);
            leftSeal.rotation.set(-0.2, 0, -0.1);
            this.interiorGroup.add(leftSeal);

            const rightSeal = new THREE.Mesh(sealGeo, rubberMat);
            rightSeal.position.set(0.922, 1.3, -0.87);
            rightSeal.rotation.set(-0.2, 0, 0.1);
            this.interiorGroup.add(rightSeal);

            // Top bar seal strip
            const topSealGeo = new THREE.BoxGeometry(1.93, 0.016, 0.016);
            const topSeal = new THREE.Mesh(topSealGeo, rubberMat);
            topSeal.position.set(0, 1.63, -0.91);
            this.interiorGroup.add(topSeal);

            // Bottom dash-top seal (where glass meets dashboard)
            const bottomSealGeo = new THREE.BoxGeometry(1.93, 0.016, 0.016);
            const bottomSeal = new THREE.Mesh(bottomSealGeo, rubberMat);
            bottomSeal.position.set(0, 0.96, -0.86);
            this.interiorGroup.add(bottomSeal);
        }

        // Rearview mirror mount (small bar on windshield top)
        const mirrorMountGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 6);
        const mirrorMount = new THREE.Mesh(mirrorMountGeo, this.metalMaterial);
        mirrorMount.position.set(0, 1.5, -0.85);
        this.interiorGroup.add(mirrorMount);
    }

    /**
     * Build rear window frame and glass
     * Creates C-pillars and rear glass to complete the interior shell
     */
    private buildWindshieldGlass(): void {
        // Curved windshield plane with subdivision for smooth bending
        const geometry = new THREE.PlaneGeometry(1.9, 0.75, 16, 8);
        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            // Slight outward bulge (parabolic curve across width)
            const zOffset = -(x * x) * 0.15;
            // Slight rake (top tilts back more than bottom)
            const rake = (y - 0.375) * 0.12;
            pos.setZ(i, zOffset + rake);
        }
        geometry.computeVertexNormals();

        const glassMat = createGlassMaterial('#eef5f8', 0.1);
        this.windshieldGlassMesh = new THREE.Mesh(geometry, glassMat);
        this.windshieldGlassMesh.name = 'windshieldGlass';
        this.windshieldGlassMesh.position.set(0, 1.3, -0.88);
        this.windshieldGlassMesh.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(this.windshieldGlassMesh);
    }

    private buildRearWindow(): void {
        // Rear window top frame (connecting C-pillars)
        const rearTopBarGeo = new THREE.BoxGeometry(1.9, 0.05, 0.05);
        const rearTopBar = new THREE.Mesh(rearTopBarGeo, this.frameMaterial);
        rearTopBar.position.set(0, 1.58, 0.6);
        this.interiorGroup.add(rearTopBar);

        // C-pillars (rear window sides) - angled inward
        const cPillarGeo = new THREE.BoxGeometry(0.06, 0.5, 0.05);
        
        // Left C-pillar
        const leftCPillar = new THREE.Mesh(cPillarGeo, this.frameMaterial);
        leftCPillar.position.set(-0.92, 1.33, 0.6);
        leftCPillar.rotation.z = -0.12;
        this.interiorGroup.add(leftCPillar);
        
        // Right C-pillar
        const rightCPillar = new THREE.Mesh(cPillarGeo, this.frameMaterial);
        rightCPillar.position.set(0.92, 1.33, 0.6);
        rightCPillar.rotation.z = 0.12;
        this.interiorGroup.add(rightCPillar);

        // Rear window bottom frame (parcel shelf edge)
        const rearBottomBarGeo = new THREE.BoxGeometry(1.85, 0.04, 0.04);
        const rearBottomBar = new THREE.Mesh(rearBottomBarGeo, this.frameMaterial);
        rearBottomBar.position.set(0, 1.1, 0.62);
        this.interiorGroup.add(rearBottomBar);

        // Rear glass plane (transparent, tinted automotive glass)
        const rearGlassGeo = new THREE.PlaneGeometry(1.8, 0.48);
        const rearGlassMat = createGlassMaterial('#6a9aae', 0.15);
        this.rearGlassMesh = new THREE.Mesh(rearGlassGeo, rearGlassMat);
        this.rearGlassMesh.name = 'rearGlass';
        this.rearGlassMesh.position.set(0, 1.34, 0.64);
        this.interiorGroup.add(this.rearGlassMesh);

        // Defroster lines (subtle horizontal lines on rear glass)
        for (let i = 0; i < 4; i++) {
            const defrosterGeo = new THREE.BoxGeometry(1.7, 0.002, 0.001);
            const defroster = new THREE.Mesh(defrosterGeo, new THREE.MeshBasicMaterial({
                color: 0x333333,
                transparent: true,
                opacity: 0.3,
            }));
            defroster.position.set(0, 1.2 + i * 0.08, 0.641);
            this.interiorGroup.add(defroster);
        }

        // Parcel shelf (below rear window)
        const parcelShelfGeo = new THREE.BoxGeometry(1.8, 0.05, 0.5);
        const parcelShelfMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.9,
        });
        const parcelShelf = new THREE.Mesh(parcelShelfGeo, parcelShelfMat);
        parcelShelf.position.set(0, 1.08, 0.4);
        this.interiorGroup.add(parcelShelf);
    }

    private buildSideMirrors(): void {
        // Left side mirror
        const leftMirrorFrameGeo = new THREE.BoxGeometry(0.05, 0.25, 0.08);
        const leftMirrorFrame = new THREE.Mesh(leftMirrorFrameGeo, this.frameMaterial);
        leftMirrorFrame.position.set(-1.0, 1.05, -0.5);
        leftMirrorFrame.rotation.set(0, 0.3, 0);
        this.interiorGroup.add(leftMirrorFrame);

        const leftMirrorPlaneGeo = new THREE.PlaneGeometry(0.15, 0.2);
        this.leftMirrorPlane = new THREE.Mesh(leftMirrorPlaneGeo, this.mirrorMaterial);
        this.leftMirrorPlane.position.set(-0.98, 1.05, -0.52);
        this.leftMirrorPlane.rotation.set(0, 0.5, 0);
        this.interiorGroup.add(this.leftMirrorPlane);

        // Right side mirror
        const rightMirrorFrameGeo = new THREE.BoxGeometry(0.05, 0.25, 0.08);
        const rightMirrorFrame = new THREE.Mesh(rightMirrorFrameGeo, this.frameMaterial);
        rightMirrorFrame.position.set(1.0, 1.05, -0.5);
        rightMirrorFrame.rotation.set(0, -0.3, 0);
        this.interiorGroup.add(rightMirrorFrame);

        const rightMirrorPlaneGeo = new THREE.PlaneGeometry(0.15, 0.2);
        this.rightMirrorPlane = new THREE.Mesh(rightMirrorPlaneGeo, this.mirrorMaterial);
        this.rightMirrorPlane.position.set(0.98, 1.05, -0.52);
        this.rightMirrorPlane.rotation.set(0, -0.5, 0);
        this.interiorGroup.add(this.rightMirrorPlane);
    }

    private buildWipers(): void {
        // Wiper pivots sit mid-to-upper windshield (y≈1.2, around driver eye level).
        // Blades extend *upward* (+y offset) so they sweep across the glass the correct way.
        this.wiperLeft = new THREE.Group();
        this.wiperLeft.position.set(-0.2, 1.1, -0.9);
        this.interiorGroup.add(this.wiperLeft);

        const leftWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const leftWiperBlad = new THREE.Mesh(leftWiperBladGeo, this.metalMaterial);
        leftWiperBlad.position.set(0, 0.15, 0);
        leftWiperBlad.rotation.set(0, 0, -Math.PI / 6);
        this.wiperLeft.add(leftWiperBlad);

        // Right wiper (group for animation)
        this.wiperRight = new THREE.Group();
        this.wiperRight.position.set(0.2, 1.1, -0.9);
        this.interiorGroup.add(this.wiperRight);

        const rightWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const rightWiperBlad = new THREE.Mesh(rightWiperBladGeo, this.metalMaterial);
        rightWiperBlad.position.set(0, 0.15, 0);
        rightWiperBlad.rotation.set(0, 0, Math.PI / 6);
        this.wiperRight.add(rightWiperBlad);
    }

    private buildGauges(): void {
        // --- Shared canvas dial builder ---
        const buildDialCanvas = (size: number, emissiveColor: string, labelMax: number, unit: string): HTMLCanvasElement => {
            const c = document.createElement('canvas');
            c.width = size; c.height = size;
            const ctx = c.getContext('2d')!;

            // Background gradient
            const bg = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
            bg.addColorStop(0, '#222222');
            bg.addColorStop(1, '#0d0d0d');
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
            ctx.fill();

            // Outer ring
            ctx.strokeStyle = emissiveColor;
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.45;
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2 - 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Tick marks (major every 30°, minor every 10°)
            const startAngle = -Math.PI * 0.75; // 225° start
            const sweepAngle = Math.PI * 1.5;    // 270° sweep
            const majorTicks = 6;
            const minorTicks = 30;
            for (let i = 0; i <= minorTicks; i++) {
                const a = startAngle + (i / minorTicks) * sweepAngle;
                const isMajor = i % (minorTicks / majorTicks) === 0;
                const inner = isMajor ? size/2 - 18 : size/2 - 11;
                const outer = size/2 - 6;
                ctx.strokeStyle = isMajor ? emissiveColor : 'rgba(255,255,255,0.35)';
                ctx.lineWidth = isMajor ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(size/2 + Math.cos(a) * inner, size/2 + Math.sin(a) * inner);
                ctx.lineTo(size/2 + Math.cos(a) * outer, size/2 + Math.sin(a) * outer);
                ctx.stroke();

                // Major tick labels
                if (isMajor) {
                    const labelRadius = size/2 - 28;
                    const val = Math.round((i / minorTicks) * labelMax);
                    ctx.fillStyle = 'rgba(255,255,255,0.75)';
                    ctx.font = `bold ${Math.round(size * 0.10)}px "Arial Narrow", Arial, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(String(val), size/2 + Math.cos(a) * labelRadius, size/2 + Math.sin(a) * labelRadius);
                }
            }

            // Unit label at bottom
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = `${Math.round(size * 0.09)}px "Arial Narrow", Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(unit, size/2, size/2 + size * 0.28);

            // Center hub fill
            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.arc(size/2, size/2, size * 0.08, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = emissiveColor;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.arc(size/2, size/2, size * 0.08, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            return c;
        };

        // Speedometer
        const speedDialCanvas = buildDialCanvas(256, '#00dd88', 300, 'km/h');
        const speedTex = new THREE.CanvasTexture(speedDialCanvas);
        const speedoMat = new THREE.MeshStandardMaterial({
            map: speedTex,
            roughness: 0.7,
            emissive: new THREE.Color(0x004422),
            emissiveIntensity: 0.25,
            emissiveMap: speedTex,
        });
        const speedoGeo = new THREE.CircleGeometry(0.15, 32);
        const speedometer = new THREE.Mesh(speedoGeo, speedoMat);
        speedometer.position.set(-0.5, 0.95, -0.72);
        this.interiorGroup.add(speedometer);

        // Speedometer needle
        const needleGeo = new THREE.BoxGeometry(0.008, 0.12, 0.008);
        this.speedometerNeedle = new THREE.Mesh(needleGeo, this.metalMaterial);
        this.speedometerNeedle.position.set(-0.5, 0.98, -0.71);
        this.interiorGroup.add(this.speedometerNeedle);

        // Tachometer
        const tachoDialCanvas = buildDialCanvas(256, '#dd2200', 8, 'x1000');
        const tachoTex = new THREE.CanvasTexture(tachoDialCanvas);
        const tachoMat = new THREE.MeshStandardMaterial({
            map: tachoTex,
            roughness: 0.7,
            emissive: new THREE.Color(0x220000),
            emissiveIntensity: 0.25,
            emissiveMap: tachoTex,
        });
        const tachoGeo = new THREE.CircleGeometry(0.15, 32);
        const tachometer = new THREE.Mesh(tachoGeo, tachoMat);
        tachometer.position.set(-0.15, 0.95, -0.72);
        this.interiorGroup.add(tachometer);

        // Tachometer needle
        const tachoNeedleGeo = new THREE.BoxGeometry(0.008, 0.12, 0.008);
        this.tachometerNeedle = new THREE.Mesh(tachoNeedleGeo, this.metalMaterial);
        this.tachometerNeedle.position.set(-0.15, 0.98, -0.71);
        this.interiorGroup.add(this.tachometerNeedle);
    }

    /**
     * Build premium digital clock display on the dashboard.
     * Positioned right of center display with a realistic dashboard angle.
     * Only rendered at medium/high quality.
     */
    private buildDigitalClock(): void {
        this.clockCanvas = document.createElement('canvas');
        this.clockCanvas.width = 256;
        this.clockCanvas.height = 80;
        this.clockCtx = this.clockCanvas.getContext('2d', { alpha: true })!;

        const clockTexture = new THREE.CanvasTexture(this.clockCanvas);
        clockTexture.anisotropy = this.gpuProfile.name === 'high' ? 8 : 4;
        clockTexture.generateMipmaps = true;

        const accentHex = parseInt(this.vehicleConfig.accentColor.replace('#', '0x'));
        const clockMaterial = new THREE.MeshStandardMaterial({
            map: clockTexture,
            emissive: new THREE.Color(accentHex),
            emissiveIntensity: 0.75,
            emissiveMap: clockTexture,
            roughness: 0.25,
            metalness: 0.15,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
        });

        const clockGeo = new THREE.PlaneGeometry(0.22, 0.072);
        this.digitalClockMesh = new THREE.Mesh(clockGeo, clockMaterial);
        // Right of center display, slight forward tilt to match dashboard angle
        this.digitalClockMesh.position.set(0.42, 0.91, -0.732);
        this.digitalClockMesh.rotation.set(-0.18, 0, 0);
        this.interiorGroup.add(this.digitalClockMesh);

        // Render first frame immediately, then start live updates every 500 ms.
        // 500ms is intentional: the colon blinks on/off each tick for classic dash behavior.
        this.updateDigitalClock();
        this.clockUpdateInterval = window.setInterval(() => {
            this.updateDigitalClock();
        }, 500);
    }

    /**
     * Update the digital clock canvas texture with current time and premium styling:
     * carbon-hint background, bevel recess, blinking colon, outer chrome bezel,
     * and controlled bloom-friendly glow.
     */
    private updateDigitalClock(): void {
        if (!this.clockCtx || !this.digitalClockMesh) return;

        const ctx = this.clockCtx;
        const W = this.clockCanvas.width;
        const H = this.clockCanvas.height;

        // --- Background ---
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, W, H);

        // Subtle carbon-fiber grid hint
        ctx.strokeStyle = 'rgba(255,255,255,0.025)';
        ctx.lineWidth = 1;
        for (let x = 8; x < W; x += 6) {
            ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, H - 6); ctx.stroke();
        }
        for (let y = 8; y < H; y += 6) {
            ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(W - 6, y); ctx.stroke();
        }

        // Inner bevel recess (depth illusion)
        const bevel = ctx.createLinearGradient(0, 0, 0, H);
        bevel.addColorStop(0,    'rgba(255,255,255,0.12)');
        bevel.addColorStop(0.12, 'rgba(0,0,0,0.45)');
        bevel.addColorStop(0.88, 'rgba(0,0,0,0.45)');
        bevel.addColorStop(1,    'rgba(255,255,255,0.08)');
        ctx.fillStyle = bevel;
        ctx.fillRect(6, 6, W - 12, H - 12);

        // --- Time ---
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        this.clockColonVisible = !this.clockColonVisible;
        const timeString = this.clockColonVisible ? `${hh}:${mm}` : `${hh} ${mm}`;

        const accentColor = this.vehicleConfig.accentColor || '#00ffcc';

        // Glow pass
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 14;
        ctx.fillStyle = accentColor;
        ctx.font = '700 46px "Courier New", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(timeString, W / 2 + 0.5, H / 2 + 1.5);

        // Crisp foreground pass (reset shadow)
        ctx.shadowBlur = 0;
        ctx.fillText(timeString, W / 2, H / 2 + 1);

        // --- Outer chrome bezel ---
        ctx.strokeStyle = '#2a2a38';
        ctx.lineWidth = 3;
        ctx.strokeRect(3, 3, W - 6, H - 6);

        ctx.strokeStyle = '#555566';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(5, 5, W - 10, H - 10);

        // Top highlight stripe
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(W - 8, 8); ctx.stroke();

        // --- Refresh texture ---
        const clockMat = this.digitalClockMesh.material as THREE.MeshStandardMaterial;
        if (clockMat.map) clockMat.map.needsUpdate = true;
    }

    /**
     * Switch to a different vehicle type
     * Rebuilds the interior with the new configuration
     */
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
        
        // Update camera anchor position for the new vehicle
        const { x, y, z } = this.vehicleConfig.cameraPosition;
        this.driverSeatGroup.position.set(x, y, z);
        
        // Recreate materials and rebuild
        const mats = createMaterials(this.vehicleConfig, this.gpuProfile);
        this.dashboardMaterial = mats.dashboard;
        this.leatherMaterial = mats.leather;
        this.metalMaterial = mats.metal;
        this.frameMaterial = mats.frame;
        this.glassMaterial = mats.glass;
        this.mirrorMaterial = mats.mirror;
        this.accentMaterial = mats.accent;
        this.buildInterior();
        
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
     * Get current vehicle configuration
     */
    public getVehicleConfig(): VehicleConfig {
        return this.vehicleConfig;
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
        // Reduced motion: snap directly to targets
        if (this.reducedMotion) {
            this.roofGroup.position.y = this.roofTargetY;
            if (this.steeringWheelGroup) {
                this.steeringWheelGroup.rotation.z = this.steeringAngle;
            }
            if (this.isWiperActive && this.quality !== 'low') {
                // Still need some time for wipers to be useful, but skip complex sine
                this.wiperLeft && (this.wiperLeft.rotation.z = -Math.PI / 6);
                this.wiperRight && (this.wiperRight.rotation.z = Math.PI / 6);
            }
            if (this.quality !== 'low') this.updateGaugles();
            if (this.lodUpdateFn) this.lodUpdateFn();
            this.lodManager.updateLOD(this.camera);
            return;
        }

        // Limit delta time to prevent large jumps (e.g., when tab is inactive)
        const clampedDelta = Math.min(deltaTime, 0.1);

        // Animate roof position (lerp)
        const currentY = this.roofGroup.position.y;
        const diff = this.roofTargetY - currentY;
        if (Math.abs(diff) > 0.001) {
            this.roofGroup.position.y += diff * Math.min(clampedDelta * 3, 1);
        }

        // Smooth steering wheel rotation (lerp to target)
        if (this.steeringWheelGroup) {
            const diff = this.steeringAngle - this.steeringWheelGroup.rotation.z;
            let shortestDiff = diff;
            if (shortestDiff > Math.PI) shortestDiff -= Math.PI * 2;
            if (shortestDiff < -Math.PI) shortestDiff += Math.PI * 2;
            this.steeringWheelGroup.rotation.z += shortestDiff * Math.min(clampedDelta * 5, 1);
        }

        // Animate wipers (skip if low quality)
        if (this.isWiperActive && this.quality !== 'low') {
            this.wiperAnimationTime += clampedDelta;
            const wiperCycle = this.wiperAnimationTime % 1.0;
            const wiperAngle = Math.sin(wiperCycle * Math.PI) * (Math.PI / 4);
            if (this.wiperLeft) this.wiperLeft.rotation.z = -wiperAngle - Math.PI / 6;
            if (this.wiperRight) this.wiperRight.rotation.z = wiperAngle + Math.PI / 6;
        }

        if (this.quality !== 'low') this.updateGaugles();
        if (this.lodUpdateFn) this.lodUpdateFn();
        this.lodManager.updateLOD(this.camera);
        if (this.rainSystem) this.rainSystem.update(deltaTime);
    }

    /**
     * Update gauge needle positions based on speed/RPM.
     * Speed: 0-100 km/h maps to gauge rotation
     * RPM: 0-8000 maps to gauge rotation
     */
    private updateGaugles(): void {
        if (this.speedometerNeedle) {
            // Speedometer: 0-300° rotation (0-100 km/h)
            const speedAngle = THREE.MathUtils.degToRad((this.speedometer / 100) * 300 - 150);
            this.speedometerNeedle.rotation.z = speedAngle;
        }

        if (this.tachometerNeedle) {
            // Tachometer: 0-300° rotation (0-8000 RPM)
            const tachoAngle = THREE.MathUtils.degToRad((this.tachometer / 8000) * 300 - 150);
            this.tachometerNeedle.rotation.z = tachoAngle;
        }
    }

    /**
     * Activate or deactivate the interior. When inactive, body pitch/roll
     * physics are ignored so the chassis stays perfectly level.
     */
    public setActive(active: boolean): void {
        this.isActive = active;
    }

    /**
     * Set the car body orientation (carHeading).
     * The interior stays level with the ground while the head can look freely.
     * When inactive (e.g. freelook mode), pitch and roll are forced to 0.
     * @param carHeading - The car's travel direction in degrees
     */
    public setCarOrientation(carHeading: number, bodyPitch: number = 0, bodyRoll: number = 0): void {
        // Car body yaw follows heading; optional pitch/roll for dynamic steering physics
        // When not active (freelook), force pitch/roll to 0 to keep chassis level
        const safePitch = this.isActive ? bodyPitch : 0;
        const safeRoll = this.isActive ? bodyRoll : 0;
        // Convert heading to radians (negative for Three.js coordinate system)
        const yawRad = -THREE.MathUtils.degToRad(carHeading);
        const pitchRad = THREE.MathUtils.degToRad(safePitch);
        const rollRad = THREE.MathUtils.degToRad(safeRoll);
        this.interiorGroup.rotation.set(pitchRad, yawRad, rollRad);
        // Camera position is inherited automatically through the scene graph:
        //   interiorGroup (rotates) → driverSeatGroup (fixed offset) → camera
    }

    /**
     * Set the head/camera orientation for looking around inside the car.
     * This only affects the camera rotation, not the car body.
     * The camera rotates independently while staying at the driver's position.
     * @param headYaw - Yaw angle in degrees (full 360° range) relative to car heading
     * @param headPitch - Pitch angle in degrees (-45 to +65)
     */
    public setHeadOrientation(headYaw: number, headPitch: number): void {
        // Full 360° yaw for free look, pitch still clamped to realistic range
        const clampedYaw = headYaw;
        const clampedPitch = Math.max(-45, Math.min(65, headPitch));

        // Camera is a child of driverSeatGroup which is a child of interiorGroup.
        // interiorGroup already carries the car heading rotation in world space,
        // so here we only need the local head-look offset.
        //
        // Looking right (positive headYaw) → clockwise → negative local Y rotation.
        // Looking up (positive headPitch) → negative local X rotation in Three.js.
        const localYaw   = -THREE.MathUtils.degToRad(clampedYaw);
        const localPitch = -THREE.MathUtils.degToRad(clampedPitch);

        // Set rotation directly - only X (pitch) and Y (yaw), Z (roll) is always 0
        this.camera.rotation.set(localPitch, localYaw, 0);
    }

    /**
     * Set the steering wheel angle based on car steering input.
     * @param angle - Steering angle in degrees (-90 to +90)
     */
    public setSteeringAngle(angle: number): void {
        // Clamp to reasonable steering range
        this.steeringAngle = THREE.MathUtils.degToRad(Math.max(-90, Math.min(90, angle)));
    }

    /**
     * Set the active wiper state.
     */
    public setWipersActive(active: boolean): void {
        this.isWiperActive = active;
        if (this.rainSystem) this.rainSystem.setWipersActive(active);
        if (!active) {
            this.wiperAnimationTime = 0;
            if (this.wiperLeft) this.wiperLeft.rotation.z = -Math.PI / 6;
            if (this.wiperRight) this.wiperRight.rotation.z = Math.PI / 6;
        }
    }

    /**
     * Update window tint darkness dynamically.
     * @param val - Tint value from 0.0 (clear) to 1.0 (dark)
     */
    public updateWindowTint(val: number): void {
        const clamped = Math.max(0, Math.min(1, val));
        const darkness = 0.1 + clamped * 0.7;
        const transmission = 1.0 - clamped * 0.6;

        if (this.windshieldGlassMesh?.material) {
            const mat = this.windshieldGlassMesh.material as THREE.MeshPhysicalMaterial;
            mat.color.set(new THREE.Color('#eef5f8')).multiplyScalar(1 - darkness * 0.5);
            mat.transmission = transmission;
        }
        if (this.rearGlassMesh?.material) {
            const mat = this.rearGlassMesh.material as THREE.MeshPhysicalMaterial;
            mat.color.set(new THREE.Color('#6a9aae')).multiplyScalar(1 - darkness * 0.5);
            mat.transmission = transmission;
        }
    }

    /**
     * Update speedometer and tachometer values.
     * @param speed - Speed in km/h (0-100)
     * @param rpm - RPM (0-8000)
     */
    public setGaugeValues(speed: number, rpm: number): void {
        this.speedometer = Math.max(0, Math.min(100, speed));
        this.tachometer = Math.max(0, Math.min(8000, rpm));
    }

    /**
     * Toggle headlights on/off.
     */
    public toggleHeadlights(): void {
        if (this.headlightsLight) {
            this.headlightsLight.intensity = this.headlightsLight.intensity > 0 ? 0 : 0.5;
        }
    }

    /**
     * Get current headlights state.
     */
    public getHeadlightsState(): boolean {
        return this.headlightsLight ? this.headlightsLight.intensity > 0 : false;
    }

    /**
     * Set headlights to a specific state.
     */
    public setHeadlights(on: boolean): void {
        if (this.headlightsLight) {
            this.headlightsLight.intensity = on ? 0.5 : 0;
        }
    }

    /** Toggle the dome light on/off. Returns the new state. */
    public toggleDomeLight(): boolean {
        this.isDomeLightOn = !this.isDomeLightOn;
        return this.isDomeLightOn;
    }

    /** Get current dome light state. */
    public getDomeLightState(): boolean {
        return this.isDomeLightOn;
    }

    /**
     * Set dome light to a specific state.
     */
    public setDomeLight(on: boolean): void {
        this.isDomeLightOn = on;
    }

    /**
     * Update interior lighting each frame based on headlights + night + dome state.
     * Call this once per animation frame.
     */
    public setInteriorLighting(headlightsOn: boolean, nightIntensity: number, domeLightOn: boolean): void {
        // Scale ambient lights down at night, up during day
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

        // Modulate interior material brightness based on time of day
        const matBrightness = 0.6 + dayFactor * 0.4; // 0.6 at night, 1.0 at day
        if (this.dashboardMaterial) {
            this.dashboardMaterial.color.setScalar(matBrightness);
        }
        if (this.leatherMaterial) {
            this.leatherMaterial.color.setScalar(matBrightness);
        }
        if (this.frameMaterial) {
            this.frameMaterial.color.setScalar(matBrightness);
        }

        // Interior bounce (warm glow on dashboard from headlights at night)
        const bounceTarget = headlightsOn ? nightIntensity * 0.35 : 0;
        this.interiorBounceLight.intensity +=
            (bounceTarget - this.interiorBounceLight.intensity) * 0.08;

        // Instrument cluster emissive
        if (this.instrumentClusterMat) {
            const target = headlightsOn ? 0.5 + nightIntensity * 0.8 : 0.5;
            this.instrumentClusterMat.emissiveIntensity +=
                (target - this.instrumentClusterMat.emissiveIntensity) * 0.08;
        }
        if (this.centerDisplayMat) {
            const target = headlightsOn ? 0.3 + nightIntensity * 0.6 : 0.3;
            this.centerDisplayMat.emissiveIntensity +=
                (target - this.centerDisplayMat.emissiveIntensity) * 0.08;
        }

        // Dome light intensity
        const domeTarget = domeLightOn ? 1.2 : 0;
        this.domeLightSource.intensity +=
            (domeTarget - this.domeLightSource.intensity) * 0.08;

        if (this.domeLightFixtureMesh) {
            const fixMat = this.domeLightFixtureMesh.material as THREE.MeshStandardMaterial;
            fixMat.emissiveIntensity +=
                ((domeLightOn ? 1.0 : 0) - fixMat.emissiveIntensity) * 0.08;
        }
        if (this.domeSwitchMesh) {
            const swMat = this.domeSwitchMesh.material as THREE.MeshStandardMaterial;
            swMat.emissiveIntensity = domeLightOn ? 0.6 : 0;
        }
        if (this.digitalClockMesh) {
            const clockMat = this.digitalClockMesh.material as THREE.MeshStandardMaterial;
            const clockTarget = domeLightOn ? 1.1 : 0.75 + nightIntensity * 0.4;
            clockMat.emissiveIntensity +=
                (clockTarget - clockMat.emissiveIntensity) * 0.08;
        }
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

    /** Set night intensity (0-1) for interior emissive glow scaling. */
    public setNightIntensity(intensity: number): void {
        this.nightIntensity = Math.max(0, Math.min(1, intensity));
    }

    /** Toggle rain droplets on the windshield. */
    public setRainActive(active: boolean): void {
        if (this.rainSystem) this.rainSystem.setActive(active);
    }

    /** Enable/disable post-processing (bloom + SMAA). */
    public setPostProcessingEnabled(enabled: boolean): void {
        this.postProcessingEnabled = enabled;
        if (this.postProcessing) this.postProcessing.setEnabled(enabled);
    }

    /** Adjust bloom strength (0-1). */
    public setBloomStrength(strength: number): void {
        if (this.postProcessing) this.postProcessing.setBloomStrength(strength);
    }

    /** Dump memory stats to the console (dev-only). */
    public logMemoryStats(): void {
        const stats = getMemoryProfiler().getStats();
        console.log('[CarInterior] Memory Stats:', stats);
    }

    /** Get current performance metrics (FPS, draw calls, etc.). */
    public getPerformanceMetrics() {
        return this.profiler?.getMetrics();
    }

    /** Get formatted performance string for debug overlay. */
    public getPerformanceString(): string {
        return this.profiler?.format() ?? '';
    }

    /**
     * Render the car interior scene.
     * Includes frame rate limiting and frustum culling.
     */
    public render(): void {
        const now = performance.now();
        const elapsed = now - this.lastRenderTime;
        if (elapsed < this.renderInterval) return;

        if (elapsed > this.renderInterval * 2.5 && this.renderInterval < 33) {
            this.renderInterval = Math.min(33, this.renderInterval * 1.2);
        } else if (elapsed < this.renderInterval * 0.8 && this.renderInterval > 16) {
            this.renderInterval *= 0.98;
        }
        this.lastRenderTime = now;

        this.frustumCuller.update(this.camera);
        this.profiler?.beginFrame();

        if (this.postProcessing && this.postProcessingEnabled) {
            this.postProcessing.render();
        } else {
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
        }

        this.profiler?.endFrame();
    }

    /**
     * Set target frame rate for rendering
     */
    public setTargetFPS(fps: number): void {
        this.renderInterval = 1000 / fps;
        console.log('[CarInterior] Target FPS set to:', fps);
    }

    /**
     * Handle window resize.
     */
    public resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        if (this.postProcessing) this.postProcessing.setSize(width, height);
    }

    /**
     * Sync the Three.js camera field-of-view with the WebGPU shader zoom level
     * so that the car interior window openings stay aligned with the magnified panorama.
     * @param zoom - Current WebGPU zoom level (1.0 = no zoom, 3.0 = maximum)
     */
    public setZoomFOV(zoom: number): void {
        // Base FOV 60° matches Google Maps Street View zoom=1 (~90° horizontal at 16:9).
        // Dividing by zoom mirrors the same narrowing applied by the WebGPU panorama shader.
        this.camera.fov = 60 / Math.max(1, zoom);
        this.camera.updateProjectionMatrix();
    }

    /**
     * Clean up resources.
     * Includes memory profiling and proper disposal.
     */
    public dispose(): void {
        cancelAnimationFrame(this.animationId);

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
        
        // Clear references
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
