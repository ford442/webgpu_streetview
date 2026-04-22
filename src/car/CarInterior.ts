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
    private instrumentClusterMat!: THREE.MeshStandardMaterial;
    private centerDisplayMat!: THREE.MeshStandardMaterial;
    private windshieldGlassMesh!: THREE.Mesh;
    private rearGlassMesh!: THREE.Mesh;
    private isDomeLightOn: boolean = false;
    private isActive: boolean = true;

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
        this.canvas.style.zIndex = '100';
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
        // Generate procedural leather texture with multi-scale grain for realism
        const leatherCanvas = document.createElement('canvas');
        leatherCanvas.width = 256;
        leatherCanvas.height = 256;
        const ctx = leatherCanvas.getContext('2d')!;
        const imageData = ctx.createImageData(256, 256);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const px = (i / 4) % 256;
            const py = Math.floor(i / 4 / 256);
            // Multi-scale grain: fine random noise + coarse wave pattern for organic leather look
            const fine = (Math.random() - 0.5) * 22;
            const coarse = Math.sin(px * 0.18 + py * 0.1) * Math.cos(px * 0.1 - py * 0.15) * 10;
            const micro = Math.sin(px * 0.9) * Math.cos(py * 0.7) * 3;
            const base = 58;
            const v = base + fine + coarse + micro;
            data[i]     = Math.max(30, Math.min(115, v));           // Red
            data[i + 1] = Math.max(18, Math.min(82,  v * 0.71));   // Green
            data[i + 2] = Math.max(8,  Math.min(55,  v * 0.54));   // Blue
            data[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        const leatherTexture = new THREE.CanvasTexture(leatherCanvas);
        leatherTexture.wrapS = THREE.RepeatWrapping;
        leatherTexture.wrapT = THREE.RepeatWrapping;
        leatherTexture.repeat.set(3, 3); // Tile for finer apparent grain detail

        // Procedural dashboard soft-touch grain texture
        const dashCanvas = document.createElement('canvas');
        dashCanvas.width = 128;
        dashCanvas.height = 128;
        const dashCtx = dashCanvas.getContext('2d')!;
        const dashImageData = dashCtx.createImageData(128, 128);
        const dData = dashImageData.data;
        for (let i = 0; i < dData.length; i += 4) {
            const n = (Math.random() * 8) | 0; // subtle surface micro-texture
            dData[i] = dData[i + 1] = dData[i + 2] = n;
            dData[i + 3] = 255;
        }
        dashCtx.putImageData(dashImageData, 0, 0);
        const dashTexture = new THREE.CanvasTexture(dashCanvas);
        dashTexture.wrapS = THREE.RepeatWrapping;
        dashTexture.wrapT = THREE.RepeatWrapping;
        dashTexture.repeat.set(4, 4);

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
            map: this.vehicleConfig.theme === 'clinical' ? null : dashTexture,
            roughness: this.vehicleConfig.theme === 'clinical' ? 0.35 : 0.88,
            metalness: this.vehicleConfig.theme === 'clinical' ? 0.15 : 0.04,
            envMapIntensity: 0.4,
            side: THREE.DoubleSide,
        });

        // Leather material for seats — warm brown with multi-scale grain texture
        this.leatherMaterial = new THREE.MeshStandardMaterial({
            map: leatherTexture,
            roughness: 0.78,
            metalness: 0.0,
            envMapIntensity: 0.2,
            side: THREE.DoubleSide,
        });

        // Metal material for steering column, trim — brushed/polished chrome look
        this.metalMaterial = new THREE.MeshStandardMaterial({
            color: this.vehicleConfig.theme === 'clinical' ? 0xd4d4d4 : 0x969696,
            roughness: 0.22,
            metalness: 0.88,
            envMapIntensity: 1.0,
            side: THREE.DoubleSide,
        });

        // Frame material for door panels, pillars — matte soft fabric/plastic
        this.frameMaterial = new THREE.MeshStandardMaterial({
            color: this.vehicleConfig.theme === 'clinical' ? 0xeeeeee : 0x131313,
            roughness: 0.92,
            metalness: 0.0,
            envMapIntensity: 0.15,
            side: THREE.DoubleSide,
        });

        // Glass material for mirrors — reflective tinted glass
        this.glassMaterial = new THREE.MeshStandardMaterial({
            color: 0x99b8cc,
            roughness: 0.08,
            metalness: 0.6,
            transparent: true,
            opacity: 0.45,
            envMapIntensity: 1.2,
            side: THREE.FrontSide,
        });

        // Mirror material (highly reflective chrome)
        this.mirrorMaterial = new THREE.MeshStandardMaterial({
            color: 0xe0e8ec,
            roughness: 0.04,
            metalness: 1.0,
            envMapIntensity: 1.5,
            side: THREE.FrontSide,
        });

        // Accent material for vehicle-specific colors
        this.accentMaterial = new THREE.MeshStandardMaterial({
            color: parseInt(this.vehicleConfig.accentColor.replace('#', '0x')),
            roughness: 0.35,
            metalness: 0.65,
            emissive: parseInt(this.vehicleConfig.accentColor.replace('#', '0x')),
            emissiveIntensity: 0.2,
            envMapIntensity: 0.8,
            side: THREE.DoubleSide,
        });
    }

    private createLighting(): void {
        // Build a minimal lit-room environment map for image-based lighting (IBL).
        // This gives realistic specular reflections on metal, glass, and leather without
        // any external HDR file or additional imports.
        const envScene = new THREE.Scene();
        const envBoxGeo = new THREE.BoxGeometry(6, 4, 6);
        const envBoxMats = [
            new THREE.MeshBasicMaterial({ color: 0xfff5e0, side: THREE.BackSide }), // +X warm wall
            new THREE.MeshBasicMaterial({ color: 0xe8e0d0, side: THREE.BackSide }), // -X
            new THREE.MeshBasicMaterial({ color: 0xfafaf8, side: THREE.BackSide }), // +Y ceiling
            new THREE.MeshBasicMaterial({ color: 0x1a1a1e, side: THREE.BackSide }), // -Y floor
            new THREE.MeshBasicMaterial({ color: 0xfff0e4, side: THREE.BackSide }), // +Z rear
            new THREE.MeshBasicMaterial({ color: 0xe4dcd0, side: THREE.BackSide }), // -Z front
        ];
        const envBox = new THREE.Mesh(envBoxGeo, envBoxMats);
        envScene.add(envBox);
        const envLight = new THREE.PointLight(0xfff5e0, 2.5, 10);
        envLight.position.set(0, 1.8, 0);
        envScene.add(envLight);
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(envScene).texture;
        pmrem.dispose();
        envBoxGeo.dispose();
        envBoxMats.forEach(m => m.dispose());

        // Theme-specific ambient intensity
        const ambientIntensity = this.vehicleConfig.theme === 'clinical' ? 0.65 : 0.45;

        // HemisphereLight: warm sky from above, cool ground from below — much more
        // naturalistic than a flat AmbientLight and adds visible depth to the interior.
        const hemiLight = new THREE.HemisphereLight(
            0xfff5e0, // Sky color — warm daylight white
            0x1a1a28, // Ground color — cool dark
            ambientIntensity * 0.85
        );
        this.scene.add(hemiLight);

        // Small residual ambient to keep deep shadows from going fully black
        const ambient = new THREE.AmbientLight(0xffffff, ambientIntensity * 0.25);
        this.scene.add(ambient);

        // Dashboard accent glow — tinted by vehicle accent color
        const dashColor = parseInt(this.vehicleConfig.accentColor.replace('#', '0x'));
        const dashLight = new THREE.PointLight(dashColor, 0.35, 3.5);
        dashLight.position.set(0, 0.9, -0.8);
        this.scene.add(dashLight);

        // Overhead directional fill — angled slightly from the top-front to model a
        // sun or bright overhead source.  Cast at 0.45 so it doesn't flatten the scene.
        const overhead = new THREE.DirectionalLight(0xfff8f0, 0.55);
        overhead.position.set(0.3, 3, -0.5);
        this.scene.add(overhead);

        // Left window fill light (driver-side) — simulates ambient daylight streaming
        // through the side window, giving the interior its characteristic warm glow.
        const leftWindowLight = new THREE.PointLight(0xfff0dc, 0.28, 3.2);
        leftWindowLight.position.set(-0.9, 1.05, -0.1);
        this.scene.add(leftWindowLight);

        // Right window fill (passenger side) — slightly dimmer to keep the asymmetry
        // that makes a real interior look less artificially lit.
        const rightWindowLight = new THREE.PointLight(0xfff0dc, 0.18, 3.2);
        rightWindowLight.position.set(0.9, 1.05, -0.1);
        this.scene.add(rightWindowLight);

        // Headlights (toggleable via toggleHeadlights())
        this.headlightsLight = new THREE.SpotLight(0xffffcc, 0.3, 50, 0.5, 1.0, 1.0);
        this.headlightsLight.position.set(0, 0.8, -1.2);
        this.headlightsLight.target.position.set(0, 0, 10);
        this.scene.add(this.headlightsLight);
        this.scene.add(this.headlightsLight.target);
        this.headlightsLight.intensity = 0; // Off by default

        // Interior bounce light — warm, activated by headlights at night
        this.interiorBounceLight = new THREE.PointLight(0xFF9933, 0, 1.5);
        this.interiorBounceLight.position.set(0, 0.5, -0.8);
        this.scene.add(this.interiorBounceLight);

        // Dome light — ceiling warm white
        this.domeLightSource = new THREE.PointLight(0xFFE8B0, 0, 3.0);
        this.domeLightSource.position.set(0, 1.8, 0.3);
        this.interiorGroup.add(this.domeLightSource);
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

        // Add dashboard details (skip in low quality)
        if (this.quality !== 'low') {
            this.buildDashboardDetails();
        }
    }

    /**
     * Build dashboard details: air vents, HVAC controls, buttons
     */
    private buildDashboardDetails(): void {
        // Chrome/metallic material for accents
        const chromeMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.15,
            metalness: 0.9,
        });

        // Air vents (left and right)
        const ventGeo = new THREE.BoxGeometry(0.12, 0.08, 0.03);
        const ventMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
        
        // Left vent
        const leftVent = new THREE.Mesh(ventGeo, ventMat);
        leftVent.position.set(-0.7, 0.95, -0.74);
        this.interiorGroup.add(leftVent);
        
        // Left vent chrome surround
        const ventSurroundGeo = new THREE.BoxGeometry(0.14, 0.1, 0.02);
        const leftVentSurround = new THREE.Mesh(ventSurroundGeo, chromeMaterial);
        leftVentSurround.position.set(-0.7, 0.95, -0.735);
        this.interiorGroup.add(leftVentSurround);

        // Right vent
        const rightVent = new THREE.Mesh(ventGeo, ventMat);
        rightVent.position.set(0.7, 0.95, -0.74);
        this.interiorGroup.add(rightVent);
        
        const rightVentSurround = new THREE.Mesh(ventSurroundGeo, chromeMaterial);
        rightVentSurround.position.set(0.7, 0.95, -0.735);
        this.interiorGroup.add(rightVentSurround);

        // Center vent
        const centerVentGeo = new THREE.BoxGeometry(0.15, 0.06, 0.03);
        const centerVent = new THREE.Mesh(centerVentGeo, ventMat);
        centerVent.position.set(0.55, 0.95, -0.74);
        this.interiorGroup.add(centerVent);

        // HVAC Control Knobs (3 knobs)
        const knobGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.015, 16);
        const knobMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.4,
            metalness: 0.3,
        });
        
        for (let i = 0; i < 3; i++) {
            const knob = new THREE.Mesh(knobGeo, knobMat);
            knob.position.set(0.45 + i * 0.06, 0.85, -0.72);
            this.interiorGroup.add(knob);
            
            // Knob indicator line
            const indicatorGeo = new THREE.BoxGeometry(0.015, 0.002, 0.008);
            const indicator = new THREE.Mesh(indicatorGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
            indicator.position.set(0.45 + i * 0.06, 0.85, -0.715);
            this.interiorGroup.add(indicator);
        }

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
        // Chrome material for handles
        const chromeMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.15,
            metalness: 0.9,
        });

        // Soft-touch plastic for door inserts
        const softTouchMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.7,
            metalness: 0.0,
        });

        // Speaker grille material
        const grilleMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.9,
        });

        // Left door speaker grille (lower front)
        const speakerGeo = new THREE.CircleGeometry(0.08, 32);
        const leftSpeaker = new THREE.Mesh(speakerGeo, grilleMat);
        leftSpeaker.position.set(-0.96, 0.55, 0.6);
        leftSpeaker.rotation.y = Math.PI / 2;
        this.interiorGroup.add(leftSpeaker);

        // Left door speaker pattern (concentric rings)
        for (let i = 1; i <= 3; i++) {
            const ringGeo = new THREE.RingGeometry(0.015 * i, 0.015 * i + 0.005, 32);
            const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ 
                color: 0x333333,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
            }));
            ring.position.set(-0.955, 0.55, 0.6);
            ring.rotation.y = Math.PI / 2;
            this.interiorGroup.add(ring);
        }

        // Right door speaker grille
        const rightSpeaker = new THREE.Mesh(speakerGeo, grilleMat);
        rightSpeaker.position.set(0.96, 0.55, 0.6);
        rightSpeaker.rotation.y = -Math.PI / 2;
        this.interiorGroup.add(rightSpeaker);

        for (let i = 1; i <= 3; i++) {
            const ringGeo = new THREE.RingGeometry(0.015 * i, 0.015 * i + 0.005, 32);
            const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ 
                color: 0x333333,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
            }));
            ring.position.set(0.955, 0.55, 0.6);
            ring.rotation.y = -Math.PI / 2;
            this.interiorGroup.add(ring);
        }

        // Left door handle (pull handle)
        const handleGeo = new THREE.BoxGeometry(0.04, 0.015, 0.08);
        const leftHandle = new THREE.Mesh(handleGeo, chromeMaterial);
        leftHandle.position.set(-0.96, 0.92, -0.4);
        this.interiorGroup.add(leftHandle);

        // Left door handle recess
        const handleRecessGeo = new THREE.BoxGeometry(0.03, 0.04, 0.1);
        const leftHandleRecess = new THREE.Mesh(handleRecessGeo, softTouchMat);
        leftHandleRecess.position.set(-0.96, 0.9, -0.4);
        this.interiorGroup.add(leftHandleRecess);

        // Right door handle
        const rightHandle = new THREE.Mesh(handleGeo, chromeMaterial);
        rightHandle.position.set(0.96, 0.92, -0.4);
        this.interiorGroup.add(rightHandle);

        const rightHandleRecess = new THREE.Mesh(handleRecessGeo, softTouchMat);
        rightHandleRecess.position.set(0.96, 0.9, -0.4);
        this.interiorGroup.add(rightHandleRecess);

        // Window control switches (driver side)
        const switchPanelGeo = new THREE.BoxGeometry(0.03, 0.08, 0.15);
        const switchPanelMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const leftSwitchPanel = new THREE.Mesh(switchPanelGeo, switchPanelMat);
        leftSwitchPanel.position.set(-0.96, 0.85, -0.2);
        this.interiorGroup.add(leftSwitchPanel);

        // Window switches (4 small buttons)
        const switchBtnGeo = new THREE.BoxGeometry(0.008, 0.015, 0.02);
        const switchBtnMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
        for (let i = 0; i < 4; i++) {
            const switchBtn = new THREE.Mesh(switchBtnGeo, switchBtnMat);
            switchBtn.position.set(-0.945, 0.87 - i * 0.018, -0.2);
            this.interiorGroup.add(switchBtn);
        }

        // Passenger side window switch (single switch)
        const rightSwitchPanel = new THREE.Mesh(switchPanelGeo, switchPanelMat);
        rightSwitchPanel.position.set(0.96, 0.85, -0.2);
        this.interiorGroup.add(rightSwitchPanel);

        const rightSwitchBtn = new THREE.Mesh(switchBtnGeo, switchBtnMat);
        rightSwitchBtn.position.set(0.945, 0.87, -0.2);
        this.interiorGroup.add(rightSwitchBtn);

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
        
        // Update camera anchor position for the new vehicle
        const { x, y, z } = this.vehicleConfig.cameraPosition;
        this.driverSeatGroup.position.set(x, y, z);
        
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
        if (!active) {
            // Reset wipers to rest position
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
        // Center display emissive
        if (this.centerDisplayMat) {
            const target = headlightsOn ? 0.3 + nightIntensity * 0.6 : 0.3;
            this.centerDisplayMat.emissiveIntensity +=
                (target - this.centerDisplayMat.emissiveIntensity) * 0.08;
        }

        // Dome light intensity (smooth lerp toward target)
        const domeTarget = domeLightOn ? 1.2 : 0;
        this.domeLightSource.intensity +=
            (domeTarget - this.domeLightSource.intensity) * 0.08;

        // Dome fixture emissive glow
        if (this.domeLightFixtureMesh) {
            const fixMat = this.domeLightFixtureMesh.material as THREE.MeshStandardMaterial;
            fixMat.emissiveIntensity +=
                ((domeLightOn ? 1.0 : 0) - fixMat.emissiveIntensity) * 0.08;
        }
        // Switch indicator
        if (this.domeSwitchMesh) {
            const swMat = this.domeSwitchMesh.material as THREE.MeshStandardMaterial;
            swMat.emissiveIntensity = domeLightOn ? 0.6 : 0;
        }
    }

    /**
     * Test whether screen coordinates hit the dome light switch mesh.
     */
    public isDomeSwitchHit(clientX: number, clientY: number): boolean {
        if (!this.domeSwitchMesh) return false;
        const rect = this.canvas.getBoundingClientRect();
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        this.domeSwitchMesh.updateWorldMatrix(true, true);
        return raycaster.intersectObject(this.domeSwitchMesh, false).length > 0;
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
