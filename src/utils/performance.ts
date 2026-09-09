/** @fileoverview Performance optimization utilities including LOD, texture optimization, and frustum culling */
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { MATERIAL_TEXTURE_PROPS, readMaterialTexture } from './memoryProfiler';

/**
 * Which Three.js backend the cabin is running on. Defined here rather than in
 * `car/interior/createCabinRenderer.ts` because that module already depends on
 * this one (`GPUPerformanceProfile`) — one definition, one direction.
 */
export type CabinRendererBackend = 'webgl' | 'webgpu';

/**
 * Either cabin backend. The `three/webgpu` import is type-only and erases, so
 * this does not pull the WebGPU renderer out of its lazy chunk.
 */
export type CabinCapableRenderer = THREE.WebGLRenderer | WebGPURenderer;

// ============================================================
// LOD (Level of Detail) System
// ============================================================

export interface LODConfig {
  levels: LODLevel[];
  distances: number[]; // Distance thresholds for each level
}

export interface LODLevel {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

export interface LODEntry {
  mesh: THREE.LOD;
  originalPosition: THREE.Vector3;
  targetDistance: number;
}

/**
 * Setup LOD for a model group
 * Creates simplified versions of meshes for distance rendering
 */
export function setupLOD(model: THREE.Group, config?: Partial<LODConfig>): THREE.LOD {
  const lod = new THREE.LOD();
  
  // Add the main model as highest detail level
  lod.addLevel(model, 0);
  
  // Create medium detail level (simplified geometry)
  const mediumLOD = createSimplifiedLOD(model, 0.5); // 50% of vertices
  lod.addLevel(mediumLOD, config?.distances?.[0] ?? 5);
  
  // Create low detail level (box proxy)
  const lowLOD = createBoxProxy(model);
  lod.addLevel(lowLOD, config?.distances?.[1] ?? 15);
  
  return lod;
}

/**
 * Create simplified geometry by reducing vertex count
 */
function createSimplifiedLOD(model: THREE.Group, _ratio: number): THREE.Group {
  const simplified = model.clone();
  
  simplified.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry;
      
      // Create a simplified version using vertex decimation
      const positions = geo.attributes.position?.array;
      if (!positions) return;
      
      // Use simplified geometry - reduce to basic box for now
      const box = new THREE.BoxGeometry(1, 1, 1);
      child.geometry = box;
    }
  });
  
  return simplified;
}

/**
 * Create a box proxy for very distant objects
 */
function createBoxProxy(model: THREE.Group): THREE.Group {
  // Calculate bounding box
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  
  // Create simple box mesh
  const proxyGroup = new THREE.Group();
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const material = new THREE.MeshBasicMaterial({ 
    color: 0x333333,
    transparent: true,
    opacity: 0.5 
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  proxyGroup.add(mesh);
  
  return proxyGroup;
}

// ============================================================
// Vehicle Interior LOD System
// ============================================================

export interface VehicleLODConfig {
  dashboardLOD: boolean;
  seatLOD: boolean;
  interiorDetails: boolean;
}

/**
 * Setup LOD specifically for vehicle interiors
 * Optimizes dashboard, seats, and interior details based on camera distance
 */
export function setupVehicleInteriorLOD(
  interiorGroup: THREE.Group,
  camera: THREE.Camera,
  config?: Partial<VehicleLODConfig>
): () => void {
  const fullConfig: VehicleLODConfig = {
    dashboardLOD: true,
    seatLOD: true,
    interiorDetails: true,
    ...config
  };
  
  // Track LOD state
  let currentLOD = 0;
  
  // Categorize interior components
  const detailMeshes: THREE.Mesh[] = [];
  const essentialMeshes: THREE.Mesh[] = [];
  
  interiorGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      // Dashboard components
      if (obj.name.includes('dashboard') || obj.name.includes('gauge')) {
        detailMeshes.push(obj);
      }
      // Seat details
      else if (obj.name.includes('seat') || obj.name.includes('leather')) {
        detailMeshes.push(obj);
      }
      // Essential structural elements
      else if (obj.name.includes('pillar') || obj.name.includes('frame')) {
        essentialMeshes.push(obj);
      }
      // Everything else
      else {
        detailMeshes.push(obj);
      }
    }
  });
  
  // Update function to be called each frame
  const updateLOD = () => {
    const cameraPos = camera.position;
    const distance = cameraPos.distanceTo(interiorGroup.position);
    
    // Determine LOD level based on distance
    // For vehicle interior, camera should stay relatively close
    let targetLOD = 0; // Full detail
    
    if (distance > 2.0) {
      targetLOD = 1; // Medium detail - disable some effects
    }
    if (distance > 5.0) {
      targetLOD = 2; // Low detail - hide interior
    }
    
    if (targetLOD === currentLOD) return;
    currentLOD = targetLOD;
    
    switch (targetLOD) {
      case 0: // Full detail
        detailMeshes.forEach(mesh => { mesh.visible = true; });
        essentialMeshes.forEach(mesh => { mesh.visible = true; });
        break;
        
      case 1: // Medium detail - hide complex details
        if (fullConfig.interiorDetails) {
          detailMeshes.forEach(mesh => { mesh.visible = false; });
        }
        essentialMeshes.forEach(mesh => { mesh.visible = true; });
        break;
        
      case 2: // Low detail - hide everything except frame
        detailMeshes.forEach(mesh => { mesh.visible = false; });
        essentialMeshes.forEach(mesh => { 
          mesh.visible = fullConfig.dashboardLOD;
        });
        break;
    }
  };
  
  return updateLOD;
}

// ============================================================
// Texture Optimization
// ============================================================

export interface TextureOptimizationConfig {
  maxTextureSize: number;
  compress: boolean;
  useKTX2: boolean;
  anisotropy: number;
}

/**
 * Highest anisotropy the backend will honour.
 *
 * The two backends put this in different places and neither is safe to
 * duck-type for: `WebGLRenderer` also carries a deprecated top-level
 * `getMaxAnisotropy()` that forwards to `capabilities`, so probing for the
 * method matches both. Hence the explicit `backend` argument rather than
 * sniffing the renderer.
 */
function resolveMaxAnisotropy(
  renderer: CabinCapableRenderer,
  backend: CabinRendererBackend,
): number {
  if (backend === 'webgpu') {
    // Renderer.getMaxAnisotropy() -> backend.getMaxAnisotropy(); the WebGPU
    // backend answers a constant 16 and never touches the device, so this is
    // safe before `init()` resolves.
    return (renderer as WebGPURenderer).getMaxAnisotropy();
  }
  return (renderer as THREE.WebGLRenderer).capabilities.getMaxAnisotropy();
}

/**
 * Probe compressed-texture support. WebGL only: this reads extensions off the
 * raw GL context, and the WebGPU renderer's `getContext()` is an unrelated
 * no-op returning `void`, not a GL context.
 *
 * The WebGPU equivalent is `GPUAdapter.features` (`texture-compression-bc` /
 * `-etc2` / `-astc`) on the shared device, which this module does not own. Not
 * threaded through, because the list has never been used for anything but the
 * log line below — see the note on `optimizeTextures`.
 */
function probeCompressedFormats(renderer: THREE.WebGLRenderer): string[] {
  const gl = renderer.getContext();
  const supportedFormats: string[] = [];

  // Check for S3TC (DXT) compression
  const extS3TC = gl.getExtension('WEBGL_compressed_texture_s3tc');
  if (extS3TC) {
    supportedFormats.push('S3TC/DXT');
  }

  // Check for ETC2 compression (mobile)
  const extETC = gl.getExtension('WEBGL_compressed_texture_etc');
  if (extETC) {
    supportedFormats.push('ETC2');
  }

  // Check for ASTC compression (mobile)
  const extASTC = gl.getExtension('WEBGL_compressed_texture_astc');
  if (extASTC) {
    supportedFormats.push('ASTC');
  }

  // Check for PVRTC (iOS)
  const extPVRTC = gl.getExtension('WEBGL_compressed_texture_pvrtc');
  if (extPVRTC) {
    supportedFormats.push('PVRTC');
  }

  return supportedFormats;
}

/**
 * Optimize textures for performance
 * Implements compression, size limits, and anisotropic filtering
 *
 * Runs on both cabin backends. The WebGL path is unchanged: same extension
 * probe, same `capabilities.getMaxAnisotropy()`, same resulting
 * `THREE.Texture.DEFAULT_ANISOTROPY`.
 *
 * Note for anyone extending this: setting `DEFAULT_ANISOTROPY` is the only
 * effect this function actually has. `supportedFormats` is logged and then
 * dropped, `maxTextureSize` / `compress` / `useKTX2` are echoed back in the
 * return value but never applied to anything, and the one caller
 * (`CarInteriorBootstrap`) ignores the return value. Porting the rest of it to
 * WebGPU would be porting theatre — make it do something first.
 */
export function optimizeTextures(
  renderer: CabinCapableRenderer,
  backend: CabinRendererBackend,
  config?: Partial<TextureOptimizationConfig>
): TextureOptimizationConfig {
  const fullConfig: TextureOptimizationConfig = {
    maxTextureSize: 2048,
    compress: true,
    useKTX2: false, // Would require KTX2Loader
    anisotropy: 4,
    ...config
  };

  const supportedFormats = backend === 'webgl'
    ? probeCompressedFormats(renderer as THREE.WebGLRenderer)
    : [];

  // Set optimal anisotropic filtering
  const maxAnisotropy = resolveMaxAnisotropy(renderer, backend);
  const targetAnisotropy = Math.min(fullConfig.anisotropy, maxAnisotropy);

  // Configure texture defaults
  THREE.Texture.DEFAULT_ANISOTROPY = targetAnisotropy;

  console.log('[Performance] Texture optimization configured:', {
    backend,
    maxTextureSize: fullConfig.maxTextureSize,
    supportedFormats,
    anisotropy: targetAnisotropy,
    maxTextureUnits: backend === 'webgl'
      ? (renderer as THREE.WebGLRenderer).capabilities.maxTextures
      : undefined,
  });

  return {
    ...fullConfig,
    anisotropy: targetAnisotropy
  };
}

/**
 * Resize a texture to target size while maintaining aspect ratio
 */
export function resizeTexture(
  texture: THREE.Texture,
  maxSize: number
): THREE.Texture {
  const image = texture.image;
  if (!image) return texture;
  
  const width = image.width || image.videoWidth || 0;
  const height = image.height || image.videoHeight || 0;
  
  if (width <= maxSize && height <= maxSize) return texture;
  
  // Calculate new size maintaining aspect ratio
  const ratio = Math.min(maxSize / width, maxSize / height);
  const newWidth = Math.floor(width * ratio);
  const newHeight = Math.floor(height * ratio);
  
  // Create canvas for resizing
  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d')!;
  
  ctx.drawImage(image, 0, 0, newWidth, newHeight);
  
  const newTexture = new THREE.CanvasTexture(canvas);
  newTexture.colorSpace = texture.colorSpace;
  newTexture.wrapS = texture.wrapS;
  newTexture.wrapT = texture.wrapT;
  newTexture.minFilter = texture.minFilter;
  newTexture.magFilter = texture.magFilter;
  
  return newTexture;
}

/**
 * Get recommended texture format for current platform
 */
export function getOptimalTextureFormat(): string {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  
  if (!gl) return 'rgba8unorm';
  
  // Check for compressed formats
  if (gl.getExtension('WEBGL_compressed_texture_s3tc')) {
    return 'bc7'; // or 'bc1' for opaque textures
  }
  
  if (gl.getExtension('WEBGL_compressed_texture_astc')) {
    return 'astc-4x4';
  }
  
  if (gl.getExtension('WEBGL_compressed_texture_etc')) {
    return 'etc2-rgba8unorm';
  }
  
  return 'rgba8unorm';
}

// ============================================================
// Frustum Culling
// ============================================================

export interface FrustumCullConfig {
  cullSkybox: boolean;
  cullDistance: number;
  margin: number;
}

/**
 * Frustum culling helper for optimizing skybox rendering
 */
export class FrustumCuller {
  private frustum: THREE.Frustum;
  private projScreenMatrix: THREE.Matrix4;
  private _workingBox: THREE.Box3;
  private _workingVector: THREE.Vector3;
  
  constructor() {
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
    this._workingBox = new THREE.Box3();
    this._workingVector = new THREE.Vector3();
  }
  
  /**
   * Update frustum from camera
   */
  update(camera: THREE.Camera): void {
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }
  
  /**
   * Check if a bounding sphere is within the frustum
   */
  intersectsSphere(sphere: THREE.Sphere): boolean {
    return this.frustum.intersectsSphere(sphere);
  }
  
  /**
   * Check if a bounding box is within the frustum
   */
  intersectsBox(box: THREE.Box3): boolean {
    return this.frustum.intersectsBox(box);
  }
  
  /**
   * Check if an object is visible (for skybox culling)
   * Skybox is always visible, but this can be used for additional objects
   */
  isObjectVisible(object: THREE.Object3D, margin: number = 0.1): boolean {
    const box = this._workingBox.setFromObject(object);
    
    // Expand box by margin
    if (margin > 0) {
      const size = this._workingVector;
      box.getSize(size);
      const expand = size.multiplyScalar(margin);
      box.expandByVector(expand);
    }
    
    return this.intersectsBox(box);
  }
}

/**
 * Create optimized skybox with frustum culling
 * For Street View panoramas, we can optimize based on view direction
 */
export function createOptimizedSkybox(
  texture: THREE.Texture,
  config?: Partial<FrustumCullConfig>
): {
  mesh: THREE.Mesh;
  update: (camera: THREE.Camera) => void;
} {
  const fullConfig: FrustumCullConfig = {
    cullSkybox: false, // Skybox is usually always visible
    cullDistance: 1000,
    margin: 0.1,
    ...config
  };
  
  // Create sphere geometry for skybox
  const geometry = new THREE.SphereGeometry(100, 32, 16);
  geometry.scale(-1, 1, 1); // Invert to see inside
  
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = fullConfig.cullSkybox;
  
  const culler = new FrustumCuller();
  
  const update = (camera: THREE.Camera) => {
    culler.update(camera);
    
    // Skybox always follows camera position
    mesh.position.copy(camera.position);
    
    // Optional: cull skybox if camera is too far (not applicable for skybox)
    // This is more useful for environment objects
  };
  
  return { mesh, update };
}

// ============================================================
// Performance Monitoring Helpers
// ============================================================

export interface PerformanceMetrics {
  drawCalls: number;
  triangleCount: number;
  textureCount: number;
  memoryMB: number;
}

/**
 * Get current rendering metrics from a Three.js scene
 */
export function getSceneMetrics(scene: THREE.Scene): PerformanceMetrics {
  let drawCalls = 0;
  let triangleCount = 0;
  const textures = new Set<THREE.Texture>();
  
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      drawCalls++;
      
      if (obj.geometry) {
        const geo = obj.geometry;
        if (geo.index) {
          triangleCount += geo.index.count / 3;
        } else if (geo.attributes.position) {
          triangleCount += geo.attributes.position.count / 3;
        }
      }
      
      // Count textures
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((mat) => {
        MATERIAL_TEXTURE_PROPS.forEach((prop) => {
          const tex = readMaterialTexture(mat, prop);
          if (tex) textures.add(tex);
        });
      });
    }
  });
  
  // Estimate memory usage (rough approximation)
  let memoryMB = 0;
  textures.forEach(tex => {
    if (tex.image) {
      const width = tex.image.width || tex.image.videoWidth || 0;
      const height = tex.image.height || tex.image.videoHeight || 0;
      memoryMB += (width * height * 4) / (1024 * 1024); // RGBA
    }
  });
  
  return {
    drawCalls,
    triangleCount: Math.floor(triangleCount),
    textureCount: textures.size,
    memoryMB: Math.round(memoryMB * 100) / 100
  };
}

// ============================================================
// GPU Performance Targeting
// ============================================================

export interface GPUPerformanceProfile {
  name: string;
  /**
   * Upper bound on `renderer.setPixelRatio`, not a pixel ratio itself. The
   * device ratio is read at apply time (`resolvePixelRatio`) and clamped to
   * this — a profile captured at import cannot freeze a stale
   * `devicePixelRatio` from before the window moved to another display.
   */
  maxPixelRatio: number;
  shadowMapSize: number;
  antialias: boolean;
  maxTextureSize: number;
  lodDistance: number[];
}

export const GPU_PROFILES: { high: GPUPerformanceProfile; medium: GPUPerformanceProfile; low: GPUPerformanceProfile } = {
  // High-end desktop (RTX 3080+, M1 Max)
  high: {
    name: 'high',
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    antialias: true,
    maxTextureSize: 4096,
    lodDistance: [10, 30, 100]
  },
  
  // Mid-range (GTX 1060, M1 Mac)
  medium: {
    name: 'medium',
    maxPixelRatio: 1.5,
    shadowMapSize: 1024,
    antialias: false,
    maxTextureSize: 2048,
    lodDistance: [5, 15, 50]
  },
  
  // Low-end (Integrated graphics, mobile)
  low: {
    name: 'low',
    maxPixelRatio: 1,
    shadowMapSize: 512,
    antialias: false,
    maxTextureSize: 1024,
    lodDistance: [3, 8, 20]
  }
};

/**
 * Detect GPU tier and return appropriate performance profile
 */
export function detectGPUProfile(): GPUPerformanceProfile {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  
  if (!gl) return GPU_PROFILES.low;
  
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo 
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : 'unknown';
  
  // Detect based on renderer string
  const rendererLower = renderer.toLowerCase();
  
  // High-end GPUs
  if (/rtx|rx 6|rx 7|rx 8|m1 max|m1 ultra|m2|m3|gtx 10|gtx 16|rtx 20|rtx 30|rtx 40/.test(rendererLower)) {
    // But cap at medium for very high-res displays (performance optimization)
    if (window.innerWidth > 2560 || window.innerHeight > 1440) {
      return GPU_PROFILES.medium;
    }
    return GPU_PROFILES.high;
  }
  
  // Mid-range GPUs (GTX 1060 is our target)
  if (/gtx 9|gtx 10|m1|intel.*iris|intel.*xe|rx 5/.test(rendererLower)) {
    return GPU_PROFILES.medium;
  }
  
  // Low-end / Integrated
  return GPU_PROFILES.low;
}

/**
 * The device pixel ratio a profile allows *right now*. Reads
 * `window.devicePixelRatio` at call time so a profile object that outlives a
 * display change still resolves to the current ratio.
 */
export function resolvePixelRatio(
  profile: GPUPerformanceProfile,
  devicePixelRatio: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
): number {
  return Math.min(devicePixelRatio, profile.maxPixelRatio);
}

/**
 * Apply performance profile to a Three.js renderer.
 *
 * Sole owner of `setPixelRatio` for the cabin renderer (#260) — callers must
 * not set it themselves, or the two owners disagree about the dpr clamp.
 */
export function applyPerformanceProfile(
  renderer: CabinCapableRenderer,
  profile?: GPUPerformanceProfile
): void {
  const targetProfile = profile || detectGPUProfile();
  
  renderer.setPixelRatio(resolvePixelRatio(targetProfile));
  
  console.log('[Performance] Applied profile:', targetProfile.name, targetProfile);
}

// ============================================================
// Frame Rate Optimization
// ============================================================

export interface FrameRateController {
  targetFPS: number;
  frameInterval: number;
  shouldRender: (deltaTime: number) => boolean;
  adaptiveQuality: (fps: number) => void;
}

/**
 * Create a frame rate controller for adaptive rendering
 * Maintains target FPS by skipping frames when necessary
 */
export function createFrameRateController(
  targetFPS: number = 60,
  onQualityChange?: (quality: 'high' | 'medium' | 'low') => void
): FrameRateController {
  let frameInterval = 1000 / targetFPS;
  let lastFrameTime = 0;
  let frameSkip = 0;
  let currentQuality: 'high' | 'medium' | 'low' = 'high';
  
  const shouldRender = (currentTime: number): boolean => {
    const elapsed = currentTime - lastFrameTime;
    
    if (elapsed >= frameInterval * (frameSkip + 1)) {
      lastFrameTime = currentTime;
      return true;
    }
    
    return false;
  };
  
  const adaptiveQuality = (fps: number) => {
    if (fps < targetFPS * 0.8 && currentQuality !== 'low') {
      // Drop quality
      if (currentQuality === 'high') {
        currentQuality = 'medium';
        frameSkip = 0;
      } else if (currentQuality === 'medium') {
        currentQuality = 'low';
        frameSkip = 1; // Skip every other frame
      }
      onQualityChange?.(currentQuality);
    } else if (fps > targetFPS * 0.95 && currentQuality !== 'high') {
      // Increase quality
      if (currentQuality === 'low') {
        currentQuality = 'medium';
        frameSkip = 0;
      } else if (currentQuality === 'medium') {
        currentQuality = 'high';
        frameSkip = 0;
      }
      onQualityChange?.(currentQuality);
    }
  };
  
  return {
    targetFPS,
    frameInterval,
    shouldRender,
    adaptiveQuality
  };
}
