import * as THREE from 'three';
import {
    applyPerformanceProfile,
    optimizeTextures,
    FrustumCuller,
    VehicleLODConfig,
} from '../../utils/performance';
import { detectGPUProfile } from '../../utils/performance';
import { VehicleType, VehicleConfig, getVehicleConfig } from '../VehicleManager';
import { resolveCameraFov } from '../vehicleLayout';
import { InteractionHelper } from './InteractionHelper';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import { PostProcessingManager } from './PostProcessingManager';
import { RainSystem } from './RainSystem';
import { DustMoteSystem } from './DustMoteSystem';
import { InteriorMicroInteractions } from './InteriorMicroInteractions';
import { PerformanceProfiler } from './PerformanceProfiler';
import { createMaterials } from './MaterialFactory';
import { buildInteriorLighting } from './LightingBuilder';
import { PanoEnvironment } from './PanoEnvironment';
import { CarInteriorAnimator } from './CarInteriorAnimator';
import { CarInteriorRenderer } from './CarInteriorRenderer';
import { CarInteriorLightingManager } from './CarInteriorLightingManager';
import {
    applyHeroCabinIfEnabled,
    buildInteriorFromBuilder,
    setupCarInteriorLOD,
    setupWindowWeatherOverlay,
    type CarInteriorAssemblyHost,
} from './CarInteriorAssembly';

export interface CarInteriorBootstrapResult {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    canvas: HTMLCanvasElement;
    interiorGroup: THREE.Group;
    roofGroup: THREE.Group;
    driverSeatGroup: THREE.Group;
    frustumCuller: FrustumCuller;
    lodConfig: VehicleLODConfig;
    reducedMotion: boolean;
    interaction: InteractionHelper;
    geometryFactory: GeometryFactory;
    lodManager: LODManager;
    postProcessing?: PostProcessingManager;
    rainSystem?: RainSystem;
    dustMoteSystem?: DustMoteSystem;
    microInteractions: InteriorMicroInteractions;
    profiler?: PerformanceProfiler;
    dashboardMaterial: THREE.MeshStandardMaterial;
    leatherMaterial: THREE.MeshStandardMaterial;
    metalMaterial: THREE.MeshStandardMaterial;
    frameMaterial: THREE.MeshStandardMaterial;
    glassMaterial: THREE.MeshStandardMaterial;
    mirrorMaterial: THREE.MeshStandardMaterial;
    accentMaterial: THREE.MeshStandardMaterial;
    chromeMaterial?: THREE.MeshStandardMaterial;
    hemisphereLight: THREE.HemisphereLight;
    ambientLight: THREE.AmbientLight;
    overheadLight: THREE.DirectionalLight;
    leftWindowLight: THREE.PointLight | undefined;
    rightWindowLight: THREE.PointLight | undefined;
    headlightsLight: THREE.SpotLight;
    interiorBounceLight: THREE.PointLight;
    domeLightSource: THREE.PointLight;
    dashLight: THREE.PointLight;
    sunLight: THREE.DirectionalLight;
    panoEnvironment: PanoEnvironment;
    animator: CarInteriorAnimator;
    rendererDelegate: CarInteriorRenderer;
    lightingManager: CarInteriorLightingManager;
    vehicleType: VehicleType;
    vehicleConfig: VehicleConfig;
    gpuProfile: ReturnType<typeof detectGPUProfile>;
    quality: 'high' | 'medium' | 'low';
    postProcessingEnabled: boolean;
    detailMeshes: THREE.Mesh[];
}

export function bootstrapCarInterior(
    container: HTMLElement,
    vehicleType: VehicleType,
    host: CarInteriorAssemblyHost,
    applySeatPosition: () => void,
): CarInteriorBootstrapResult {
    const scene = new THREE.Scene();
    const vehicleConfig = getVehicleConfig(vehicleType);
    const gpuProfile = detectGPUProfile();
    const quality: 'high' | 'medium' | 'low' =
        gpuProfile.name === 'low' ? 'low' : gpuProfile.name === 'medium' ? 'medium' : 'high';

    const frustumCuller = new FrustumCuller();
    const lodConfig: VehicleLODConfig = {
        dashboardLOD: true,
        seatLOD: true,
        interiorDetails: true,
    };

    const initialFov = resolveCameraFov(vehicleConfig);
    const camera = new THREE.PerspectiveCamera(
        initialFov.base,
        container.clientWidth / container.clientHeight,
        0.01,
        100,
    );
    camera.position.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(0, 0, 0);

    const useAntialias = gpuProfile.antialias;
    let renderer: THREE.WebGLRenderer;
    try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: useAntialias });
    } catch (err) {
        throw new Error(
            `Car mode requires WebGL, which is not available in this environment. ` +
            `(${err instanceof Error ? err.message : String(err)})`
        );
    }
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, gpuProfile.pixelRatio));
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;

    applyPerformanceProfile(renderer, gpuProfile);
    optimizeTextures(renderer, {
        maxTextureSize: gpuProfile.maxTextureSize,
        anisotropy: gpuProfile.name === 'high' ? 4 : 2,
    });

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '50';
    canvas.style.display = 'block';
    canvas.style.visibility = 'visible';
    container.appendChild(canvas);

    const interiorGroup = new THREE.Group();
    const roofGroup = new THREE.Group();
    scene.add(interiorGroup);
    scene.add(roofGroup);

    const driverSeatGroup = new THREE.Group();
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const interaction = new InteractionHelper();
    const geometryFactory = new GeometryFactory();
    const lodManager = new LODManager(frustumCuller);

    // Assembly reads these off `host` (not bootstrap locals). Bind them before
    // applySeatPosition / buildInteriorFromBuilder or meshes throw on .position/.add.
    host.scene = scene;
    host.camera = camera;
    host.renderer = renderer;
    host.canvas = canvas;
    host.interiorGroup = interiorGroup;
    host.roofGroup = roofGroup;
    host.driverSeatGroup = driverSeatGroup;
    host.frustumCuller = frustumCuller;
    host.lodConfig = lodConfig;
    host.reducedMotion = reducedMotion;
    host.geometryFactory = geometryFactory;
    host.lodManager = lodManager;
    host.gpuProfile = gpuProfile;
    host.quality = quality;
    host.vehicleType = vehicleType;
    host.vehicleConfig = vehicleConfig;

    applySeatPosition();
    interiorGroup.add(driverSeatGroup);
    driverSeatGroup.add(camera);

    const mats = createMaterials(vehicleConfig, gpuProfile);

    let postProcessing: PostProcessingManager | undefined;
    if (gpuProfile.name !== 'low') {
        postProcessing = new PostProcessingManager(renderer, scene, camera, gpuProfile);
    }

    const rainSystem = new RainSystem(200);
    interiorGroup.add(rainSystem.getMesh());

    let dustMoteSystem: DustMoteSystem | undefined;
    if (gpuProfile.name !== 'low') {
        dustMoteSystem = new DustMoteSystem(56);
        interiorGroup.add(dustMoteSystem.getObject());
    }

    const microInteractions = new InteriorMicroInteractions();
    const profiler = new PerformanceProfiler(renderer);

    host.dashboardMaterial = mats.dashboard;
    host.leatherMaterial = mats.leather;
    host.metalMaterial = mats.metal;
    host.frameMaterial = mats.frame;
    host.glassMaterial = mats.glass;
    host.mirrorMaterial = mats.mirror;
    host.accentMaterial = mats.accent;
    host.chromeMaterial = mats.chrome;
    // Assembly reads these off `host` (the CarInterior instance). Bind them
    // before buildInteriorFromBuilder — otherwise medium/high quality hits
    // `host.microInteractions.register(...)` while the field is still
    // uninitialized and car mode dies with a leftover empty canvas.
    host.microInteractions = microInteractions;

    const lights = buildInteriorLighting(scene, interiorGroup, renderer, vehicleConfig, { quality });
    const panoEnvironment = new PanoEnvironment(renderer, scene);

    try {
        buildInteriorFromBuilder(host);
        setupWindowWeatherOverlay(host);
        setupCarInteriorLOD(host);
    } catch (err) {
        canvas.remove();
        renderer.dispose();
        throw err;
    }

    const animator = new CarInteriorAnimator(
        camera,
        interiorGroup,
        roofGroup,
        host.steeringWheelGroup,
        host.wiperLeft,
        host.wiperRight,
        host.speedometerNeedle,
        host.tachometerNeedle,
        lodManager,
        rainSystem,
        dustMoteSystem,
        host.windowWeatherOverlay,
        microInteractions,
        host.lodUpdateFn,
        quality,
        reducedMotion
    );
    animator.setCupLiquidMaterial(host.cupLiquidMaterial);
    animator.setRoofTargetY(host.roofTargetY);
    animator.setGaugeRig(host.gaugeRig);
    host.animator = animator;
    void applyHeroCabinIfEnabled(host);

    const postProcessingEnabled = false;
    const rendererDelegate = new CarInteriorRenderer(
        renderer,
        camera,
        scene,
        postProcessing,
        canvas,
        resolveCameraFov(vehicleConfig),
    );
    rendererDelegate.setPostProcessingEnabled(postProcessingEnabled);

    const lightingManager = new CarInteriorLightingManager(
        lights.headlightsLight,
        lights.domeLightSource,
        host.domeLightFixtureMesh,
        host.domeSwitchMesh,
        host.digitalClockMesh,
        host.instrumentClusterMat,
        host.centerDisplayMat,
        lights.hemisphereLight,
        lights.ambientLight,
        lights.overheadLight,
        lights.leftWindowLight,
        lights.rightWindowLight,
        lights.interiorBounceLight,
        host.windshieldGlassMesh,
        host.rearGlassMesh,
        lights.sunLight,
        lights.dashLight,
        vehicleConfig.theme === 'clinical',
    );
    lightingManager.setReducedMotion(reducedMotion);
    lightingManager.setEmitterGlows(host.emitterGlowSprites ?? []);
    host.lightingManager = lightingManager;

    return {
        scene,
        camera,
        renderer,
        canvas,
        interiorGroup,
        roofGroup,
        driverSeatGroup,
        frustumCuller,
        lodConfig,
        reducedMotion,
        interaction,
        geometryFactory,
        lodManager,
        postProcessing,
        rainSystem,
        dustMoteSystem,
        microInteractions,
        profiler,
        dashboardMaterial: host.dashboardMaterial,
        leatherMaterial: host.leatherMaterial,
        metalMaterial: host.metalMaterial,
        frameMaterial: host.frameMaterial,
        glassMaterial: host.glassMaterial,
        mirrorMaterial: host.mirrorMaterial,
        accentMaterial: host.accentMaterial,
        chromeMaterial: host.chromeMaterial,
        hemisphereLight: lights.hemisphereLight,
        ambientLight: lights.ambientLight,
        overheadLight: lights.overheadLight,
        leftWindowLight: lights.leftWindowLight,
        rightWindowLight: lights.rightWindowLight,
        headlightsLight: lights.headlightsLight,
        interiorBounceLight: lights.interiorBounceLight,
        domeLightSource: lights.domeLightSource,
        dashLight: lights.dashLight,
        sunLight: lights.sunLight,
        panoEnvironment,
        animator,
        rendererDelegate,
        lightingManager,
        vehicleType,
        vehicleConfig,
        gpuProfile,
        quality,
        postProcessingEnabled,
        detailMeshes: host.detailMeshes,
    };
}
