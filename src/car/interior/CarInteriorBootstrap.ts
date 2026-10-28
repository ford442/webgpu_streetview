import * as THREE from 'three';
import {
    applyPerformanceProfile,
    optimizeTextures,
    FrustumCuller,
    type VehicleLODConfig,
} from './performance';
import { detectGPUProfile } from './performance';
import { type VehicleType, type VehicleConfig, getVehicleConfig } from '../VehicleManager';
import { InteractionHelper } from './InteractionHelper';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
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
import type { PostProcessingManager } from './PostProcessingManager';
import {
    applyHeroCabinIfEnabled,
    buildInteriorFromBuilder,
    setupCarInteriorLOD,
    setupWindowWeatherOverlay,
    type CarInteriorAssemblyHost,
} from './CarInteriorAssembly';
import { createCabinRenderer, type CabinRenderer, type CabinRendererHandle } from './createCabinRenderer';
import { createCabinRig } from './cabinRig';
import { panoramaMatchedVerticalFov } from '../../utils/streetViewFov';

export interface CarInteriorBootstrapResult {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: CabinRenderer;
    /** True once `renderer` can actually draw a frame — see `createCabinRenderer.ts`. */
    isRendererReady: () => boolean;
    canvas: HTMLCanvasElement;
    interiorGroup: THREE.Group;
    roofGroup: THREE.Group;
    /** Driver eye point under the car rig; parent of `camera` (see `cabinRig.ts`). */
    headPivot: THREE.Group;
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
    /** Street View's shared `GPUDevice` — see `createCabinRenderer.ts`. */
    sharedDevice?: GPUDevice,
    /** Pre-inited handle from `createCabinRendererAsync` (production path). */
    readyHandle?: CabinRendererHandle,
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

    // FOV matches the panorama (zoom 1 until the bridge pushes the store zoom),
    // or the view outside slides against the window frames as the head turns.
    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(
        panoramaMatchedVerticalFov(1, aspect),
        aspect,
        0.01,
        100,
    );
    // See the dome diffuser, which lives on layer 1 so its own point light
    // cannot blow it out. Everything else stays on layer 0. Position and
    // rotation order are set when the camera is parented to `headPivot`.
    camera.layers.enable(1);

    const cabinRenderer = readyHandle ?? createCabinRenderer({ gpuProfile, sharedDevice });
    const { renderer, isReady: isRendererReady } = cabinRenderer;
    renderer.setSize(container.clientWidth, container.clientHeight);

    // `applyPerformanceProfile` is the only caller of `setPixelRatio` (#260):
    // it clamps the live `devicePixelRatio` to the profile's cap.
    // Both backends: `optimizeTextures` takes the backend explicitly and keeps
    // the compressed-format extension probe on the WebGL side (see #258).
    applyPerformanceProfile(renderer, gpuProfile);
    optimizeTextures(renderer, cabinRenderer.backend, {
        maxTextureSize: gpuProfile.maxTextureSize,
        anisotropy: gpuProfile.name === 'high' ? 4 : 2,
    });

    const canvas = cabinRenderer.canvas;
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

    // `interiorGroup` is the car rig: identity rotation, always.
    const { carRig: interiorGroup, headPivot } = createCabinRig(camera);
    const roofGroup = new THREE.Group();
    scene.add(interiorGroup);
    scene.add(roofGroup);

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
    host.headPivot = headPivot;
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

    const mats = createMaterials(vehicleConfig, gpuProfile);

    // Do not construct EffectComposer / SMAA / bloom here. Those passes break
    // alpha compositing over the WebGPU panorama (see CarInteriorRenderer) and
    // the CopyShader/SMAA data-URL path has been crashing car init with
    // `Cannot read properties of undefined (reading 'register')` plus WebGL
    // context loss. Leave postProcessing unset; the renderer already falls
    // back to a straight WebGL draw.
    const postProcessing = undefined;

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
        isRendererReady,
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
    lightingManager.setAuxDisplayMats(host.auxDisplayMats ?? []);
    host.lightingManager = lightingManager;

    return {
        scene,
        camera,
        renderer,
        isRendererReady,
        canvas,
        interiorGroup,
        roofGroup,
        headPivot,
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
