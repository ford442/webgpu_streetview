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
    private steeringWheelGroup!: THREE.Group;
    private leftMirrorPlane!: THREE.Mesh;
    private rightMirrorPlane!: THREE.Mesh;
    private wiperLeft!: THREE.Group;
    private wiperRight!: THREE.Group;
    private speedometerNeedle!: THREE.Mesh;
    private tachometerNeedle!: THREE.Mesh;
    private headlightsLight!: THREE.SpotLight;

    private isRoofOpen: boolean = false;
    private roofTargetY: number = 0;
    private animationId: number = 0;
    private steeringAngle: number = 0;
    private wiperAnimationTime: number = 0;
    private isWiperActive: boolean = false;
    private speedometer: number = 0; // 0-100 km/h
    private tachometer: number = 0; // 0-8000 RPM

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

        // Camera at driver seat eye level (~1.2m), slightly angled toward center console
        const { x, y, z } = this.vehicleConfig.cameraPosition;
        this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.01, 100);
        this.camera.position.set(x, y, z);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(0, 0, 0);

        // Renderer with alpha for transparency - apply performance profile
        const useAntialias = this.gpuProfile.antialias;
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: useAntialias });
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
        
        this.canvas = this.renderer.domElement;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '100';
        this.canvas.style.display = 'block';
        this.canvas.style.visibility = 'visible';
        container.appendChild(this.canvas);

        this.interiorGroup = new THREE.Group();
        this.roofGroup = new THREE.Group();
        this.scene.add(this.interiorGroup);
        this.scene.add(this.roofGroup);

        // Camera is kept separate from interiorGroup to allow independent head look.
        // The interiorGroup rotates with the car body (carHeading).
        // The camera rotates independently for head look (headYaw/headPitch).
        this.scene.add(this.camera);

        this.createMaterials();
        this.createLighting();
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

    private createMaterials(): void {
        // Generate procedural noise texture via canvas for leather roughness
        const leatherCanvas = document.createElement('canvas');
        leatherCanvas.width = 128;
        leatherCanvas.height = 128;
        const ctx = leatherCanvas.getContext('2d')!;
        const imageData = ctx.createImageData(128, 128);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const v = Math.random() * 30 + 40;
            data[i] = v;           // Red
            data[i + 1] = v * 0.8; // Green
            data[i + 2] = v * 0.6; // Blue
            data[i + 3] = 255;     // Alpha
        }
        ctx.putImageData(imageData, 0, 0);
        const leatherTexture = new THREE.CanvasTexture(leatherCanvas);
        leatherTexture.wrapS = THREE.RepeatWrapping;
        leatherTexture.wrapT = THREE.RepeatWrapping;

        // Dashboard material varies by theme
        const dashboardColors = {
            dark: 0x1a1a1a,
            light: 0x2a2a2a,
            neon: 0x0a0a1a,
            clinical: 0xf0f0f0,
        };
        const dashColor = dashboardColors[this.vehicleConfig.theme] ?? 0x1a1a1a;
        
        this.dashboardMaterial = new THREE.MeshStandardMaterial({
            color: dashColor,
            roughness: this.vehicleConfig.theme === 'clinical' ? 0.3 : 0.8,
            metalness: this.vehicleConfig.theme === 'clinical' ? 0.1 : 0.1,
            side: THREE.DoubleSide,
        });

        // Leather material for seats
        this.leatherMaterial = new THREE.MeshStandardMaterial({
            map: leatherTexture,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });

        // Metal material for steering column, trim
        this.metalMaterial = new THREE.MeshStandardMaterial({
            color: this.vehicleConfig.theme === 'clinical' ? 0xcccccc : 0x888888,
            roughness: 0.3,
            metalness: 0.8,
            side: THREE.DoubleSide,
        });

        // Frame material for door panels, pillars
        this.frameMaterial = new THREE.MeshStandardMaterial({
            color: this.vehicleConfig.theme === 'clinical' ? 0xeeeeee : 0x111111,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });

        // Glass material for mirrors
        this.glassMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.1,
            metalness: 0.95,
            side: THREE.FrontSide,
        });

        // Mirror material (reflective)
        this.mirrorMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.05,
            metalness: 1.0,
            side: THREE.FrontSide,
        });

        // Accent material for vehicle-specific colors
        this.accentMaterial = new THREE.MeshStandardMaterial({
            color: parseInt(this.vehicleConfig.accentColor.replace('#', '0x')),
            roughness: 0.4,
            metalness: 0.6,
            emissive: parseInt(this.vehicleConfig.accentColor.replace('#', '0x')),
            emissiveIntensity: 0.2,
            side: THREE.DoubleSide,
        });
    }

    private createLighting(): void {
        // Theme-specific lighting
        const ambientIntensity = this.vehicleConfig.theme === 'clinical' ? 0.6 : 0.4;
        const ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
        this.scene.add(ambient);

        // Dashboard light with accent color
        const dashColor = parseInt(this.vehicleConfig.accentColor.replace('#', '0x'));
        const dashLight = new THREE.PointLight(dashColor, 0.3, 3);
        dashLight.position.set(0, 0.9, -0.8);
        this.scene.add(dashLight);

        const overhead = new THREE.DirectionalLight(0xffffff, 0.6);
        overhead.position.set(0, 3, 0);
        this.scene.add(overhead);

        // Headlights (toggleable via toggleHeadlights())
        this.headlightsLight = new THREE.SpotLight(0xffffcc, 0.3, 50, 0.5, 1.0, 1.0);
        this.headlightsLight.position.set(0, 0.8, -1.2);
        this.headlightsLight.target.position.set(0, 0, 10);
        this.scene.add(this.headlightsLight);
        this.scene.add(this.headlightsLight.target);
        this.headlightsLight.intensity = 0; // Off by default
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
        
        if (this.vehicleConfig.hasRoof) {
            this.buildRoof();
        }
        
        this.buildWindshieldFrame();
        
        if (this.vehicleConfig.hasSideMirrors) {
            this.buildSideMirrors();
        }
        
        if (this.vehicleConfig.hasWipers) {
            this.buildWipers();
        }
        
        if (this.vehicleConfig.hasGauges) {
            this.buildGauges();
        }

        // Build vehicle-specific features
        this.buildVehicleSpecificFeatures();
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
        const cluster = new THREE.Mesh(clusterGeo, clusterMat);
        cluster.position.set(-0.3, 0.95, -0.74);
        this.interiorGroup.add(cluster);

        // Center console display
        const displayGeo = new THREE.BoxGeometry(0.3, 0.2, 0.02);
        const displayMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x002200, emissiveIntensity: 0.3 });
        const display = new THREE.Mesh(displayGeo, displayMat);
        display.position.set(0.15, 0.95, -0.74);
        this.interiorGroup.add(display);
    }

    private buildSteeringWheel(): void {
        // Create steering wheel group for rotation animation
        this.steeringWheelGroup = new THREE.Group();
        this.steeringWheelGroup.position.set(-0.35, 0.95, -0.6);
        this.interiorGroup.add(this.steeringWheelGroup);

        // Steering wheel rim (torus)
        const wheelGeo = new THREE.TorusGeometry(0.18, 0.02, 8, 24);
        const wheel = new THREE.Mesh(wheelGeo, this.frameMaterial);
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
    }

    private buildSeats(): void {
        // Driver seat back
        const seatBackGeo = new THREE.BoxGeometry(0.5, 0.7, 0.12);
        const seatBack = new THREE.Mesh(seatBackGeo, this.leatherMaterial);
        seatBack.position.set(-0.35, 0.9, 0.5);
        seatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(seatBack);

        // Driver seat bottom
        const seatBottomGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
        const seatBottom = new THREE.Mesh(seatBottomGeo, this.leatherMaterial);
        seatBottom.position.set(-0.35, 0.5, 0.2);
        this.interiorGroup.add(seatBottom);

        // Passenger seat back
        const passSeatBackGeo = new THREE.BoxGeometry(0.5, 0.7, 0.12);
        const passSeatBack = new THREE.Mesh(passSeatBackGeo, this.leatherMaterial);
        passSeatBack.position.set(0.45, 0.9, 0.5);
        passSeatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(passSeatBack);

        // Passenger seat bottom
        const passSeatBottomGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
        const passSeatBottom = new THREE.Mesh(passSeatBottomGeo, this.leatherMaterial);
        passSeatBottom.position.set(0.45, 0.5, 0.2);
        this.interiorGroup.add(passSeatBottom);

        // Headrest driver
        const headrestGeo = new THREE.BoxGeometry(0.2, 0.2, 0.08);
        const headrest = new THREE.Mesh(headrestGeo, this.leatherMaterial);
        headrest.position.set(-0.35, 1.35, 0.5);
        this.interiorGroup.add(headrest);

        // Headrest passenger
        const headrestPassGeo = new THREE.BoxGeometry(0.2, 0.2, 0.08);
        const headrestPass = new THREE.Mesh(headrestPassGeo, this.leatherMaterial);
        headrestPass.position.set(0.45, 1.35, 0.5);
        this.interiorGroup.add(headrestPass);
    }

    private buildFloor(): void {
        const floorGeo = new THREE.PlaneGeometry(2.0, 2.5);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.95,
            side: THREE.DoubleSide,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.set(-Math.PI / 2, 0, 0);
        floor.position.set(0, 0.35, 0);
        this.interiorGroup.add(floor);
    }

    private buildRoof(): void {
        // Convertible roof - can be toggled open/closed
        const roofGeo = new THREE.BoxGeometry(2.0, 0.05, 2.0);
        const roofMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.9,
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

        // Rearview mirror mount (small bar on windshield top)
        const mirrorMountGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 6);
        const mirrorMount = new THREE.Mesh(mirrorMountGeo, this.metalMaterial);
        mirrorMount.position.set(0, 1.5, -0.85);
        this.interiorGroup.add(mirrorMount);
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
        // Left wiper (group for animation)
        this.wiperLeft = new THREE.Group();
        this.wiperLeft.position.set(-0.2, 1.4, -0.9);
        this.interiorGroup.add(this.wiperLeft);

        const leftWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const leftWiperBlad = new THREE.Mesh(leftWiperBladGeo, this.metalMaterial);
        leftWiperBlad.position.set(0, -0.15, 0);
        leftWiperBlad.rotation.set(0, 0, -Math.PI / 6);
        this.wiperLeft.add(leftWiperBlad);

        // Right wiper (group for animation)
        this.wiperRight = new THREE.Group();
        this.wiperRight.position.set(0.2, 1.4, -0.9);
        this.interiorGroup.add(this.wiperRight);

        const rightWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const rightWiperBlad = new THREE.Mesh(rightWiperBladGeo, this.metalMaterial);
        rightWiperBlad.position.set(0, -0.15, 0);
        rightWiperBlad.rotation.set(0, 0, Math.PI / 6);
        this.wiperRight.add(rightWiperBlad);
    }

    private buildGauges(): void {
        // Speedometer
        const speedoGeo = new THREE.CircleGeometry(0.15, 32);
        const speedoMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.8,
            emissive: 0x001a00,
            emissiveIntensity: 0.2,
        });
        const speedometer = new THREE.Mesh(speedoGeo, speedoMat);
        speedometer.position.set(-0.5, 0.95, -0.72);
        this.interiorGroup.add(speedometer);

        // Speedometer needle
        const needleGeo = new THREE.BoxGeometry(0.008, 0.12, 0.008);
        this.speedometerNeedle = new THREE.Mesh(needleGeo, this.metalMaterial);
        this.speedometerNeedle.position.set(-0.5, 0.98, -0.71);
        this.interiorGroup.add(this.speedometerNeedle);

        // Tachometer
        const tachoGeo = new THREE.CircleGeometry(0.15, 32);
        const tachoMat = new THREE.MeshStandardMaterial({
            color: 0x1a0000,
            roughness: 0.8,
            emissive: 0x330000,
            emissiveIntensity: 0.2,
        });
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
        
        // Update camera position
        const { x, y, z } = this.vehicleConfig.cameraPosition;
        this.camera.position.set(x, y, z);
        
        // Recreate materials and rebuild
        this.createMaterials();
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
        // Limit delta time to prevent large jumps (e.g., when tab is inactive)
        const clampedDelta = Math.min(deltaTime, 0.1);
        
        // Animate roof position (lerp)
        const currentY = this.roofGroup.position.y;
        const targetY = this.roofTargetY;
        const diff = targetY - currentY;
        if (Math.abs(diff) > 0.001) {
            this.roofGroup.position.y += diff * Math.min(clampedDelta * 3, 1);
        }

        // Smooth steering wheel rotation (lerp to target)
        if (this.steeringWheelGroup) {
            const targetAngle = this.steeringAngle;
            const diff = targetAngle - this.steeringWheelGroup.rotation.z;
            // Handle angle wrapping
            let shortestDiff = diff;
            if (shortestDiff > Math.PI) shortestDiff -= Math.PI * 2;
            if (shortestDiff < -Math.PI) shortestDiff += Math.PI * 2;
            this.steeringWheelGroup.rotation.z += shortestDiff * Math.min(clampedDelta * 5, 1);
        }

        // Animate wipers (skip if low quality)
        if (this.isWiperActive && this.quality !== 'low') {
            this.wiperAnimationTime += clampedDelta;
            const wiperCycle = this.wiperAnimationTime % 1.0; // 1 second cycle
            const wiperAngle = Math.sin(wiperCycle * Math.PI) * (Math.PI / 4); // Sweep ±45°
            if (this.wiperLeft) {
                this.wiperLeft.rotation.z = -wiperAngle - Math.PI / 6;
            }
            if (this.wiperRight) {
                this.wiperRight.rotation.z = wiperAngle + Math.PI / 6;
            }
        }

        // Update gauge needles (skip if low quality)
        if (this.quality !== 'low') {
            this.updateGaugles();
        }
        
        // Update LOD based on camera distance
        if (this.lodUpdateFn) {
            this.lodUpdateFn();
        }
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

    // Store current car heading for camera positioning
    private currentCarHeading: number = 0;

    /**
     * Set the car body orientation (carHeading).
     * The interior stays level with the ground while the head can look freely.
     * @param carHeading - The car's travel direction in degrees
     */
    public setCarOrientation(carHeading: number): void {
        // Car body stays level with ground - no pitch or roll, just yaw
        // Convert heading to radians (negative for Three.js coordinate system)
        const yawRad = -THREE.MathUtils.degToRad(carHeading);
        this.interiorGroup.rotation.set(0, yawRad, 0);
        this.currentCarHeading = carHeading;
        
        // Update camera position to follow the car's rotation
        // Camera stays at driver seat position relative to car
        const { x, y, z } = this.vehicleConfig.cameraPosition;
        // Rotate the camera position around the car's center based on car heading
        const cosYaw = Math.cos(yawRad);
        const sinYaw = Math.sin(yawRad);
        const rotatedX = x * cosYaw - z * sinYaw;
        const rotatedZ = x * sinYaw + z * cosYaw;
        this.camera.position.set(rotatedX, y, rotatedZ);
    }

    /**
     * Set the head/camera orientation for looking around inside the car.
     * This only affects the camera rotation, not the car body.
     * The camera rotates independently while staying at the driver's position.
     * @param headYaw - Yaw angle in degrees (-110 to +110) relative to car heading
     * @param headPitch - Pitch angle in degrees (-45 to +65)
     */
    public setHeadOrientation(headYaw: number, headPitch: number): void {
        // Clamp to realistic head movement ranges
        const clampedYaw = Math.max(-110, Math.min(110, headYaw));
        const clampedPitch = Math.max(-45, Math.min(65, headPitch));
        
        const yawRad = THREE.MathUtils.degToRad(clampedYaw);
        const pitchRad = THREE.MathUtils.degToRad(clampedPitch);
        const carYawRad = -THREE.MathUtils.degToRad(this.currentCarHeading);
        
        // Camera rotation is completely independent from car/interior rotation.
        // We only rotate the camera, NEVER the interiorGroup.
        // 
        // In Cab Mode:
        // - carHeading rotates interiorGroup (Y axis only)
        // - headYaw/headPitch rotate camera (X/Y axes only, no Z roll)
        // - Camera position follows car but rotation is free
        //
        // Yaw rotation: car heading + head look offset
        // Looking right (positive headYaw) = clockwise rotation = negative Y in Three.js
        const totalYaw = carYawRad - yawRad;
        
        // Pitch rotation: look up (positive headPitch) = negative X rotation in Three.js
        // (negative because Three.js positive X rotation looks down)
        const totalPitch = -pitchRad;
        
        // Set rotation directly - only X (pitch) and Y (yaw), Z (roll) is always 0
        this.camera.rotation.set(totalPitch, totalYaw, 0);
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
        if (!active) {
            // Reset wipers to rest position
            this.wiperAnimationTime = 0;
            if (this.wiperLeft) this.wiperLeft.rotation.z = -Math.PI / 6;
            if (this.wiperRight) this.wiperRight.rotation.z = Math.PI / 6;
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
     * Test whether the given screen coordinates intersect the steering wheel geometry.
     * Used to detect when the user clicks on the steering wheel for car-steering drag.
     * @param clientX - Mouse clientX from a DOM MouseEvent
     * @param clientY - Mouse clientY from a DOM MouseEvent
     * @returns true if the ray from the camera hits the steering wheel group
     */
    public isSteeringWheelHit(clientX: number, clientY: number): boolean {
        if (!this.steeringWheelGroup) return false;
        const rect = this.canvas.getBoundingClientRect();
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        // Ensure world matrices are current before testing
        this.steeringWheelGroup.updateWorldMatrix(true, true);
        const intersects = raycaster.intersectObject(this.steeringWheelGroup, true);
        return intersects.length > 0;
    }

    /**
     * Render the car interior scene.
     * Includes frame rate limiting and frustum culling.
     */
    public render(): void {
        // Frame rate limiting - skip render if too soon
        const now = performance.now();
        const elapsed = now - this.lastRenderTime;
        if (elapsed < this.renderInterval) {
            return; // Skip this frame
        }
        this.lastRenderTime = now;
        
        // Update frustum culling
        this.frustumCuller.update(this.camera);
        
        // Render the scene
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
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
    }

    /**
     * Clean up resources.
     * Includes memory profiling and proper disposal.
     */
    public dispose(): void {
        cancelAnimationFrame(this.animationId);
        
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
