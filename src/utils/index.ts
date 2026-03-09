/**
 * Utils index - Export all utility functions
 */

// Performance optimization utilities
export {
  // LOD
  setupLOD,
  setupVehicleInteriorLOD,
  type LODConfig,
  type LODLevel,
  type LODEntry,
  type VehicleLODConfig,
  
  // Texture optimization
  optimizeTextures,
  resizeTexture,
  getOptimalTextureFormat,
  type TextureOptimizationConfig,
  
  // Frustum culling
  FrustumCuller,
  createOptimizedSkybox,
  type FrustumCullConfig,
  
  // Performance metrics
  getSceneMetrics,
  type PerformanceMetrics,
  
  // GPU profiles
  GPU_PROFILES,
  detectGPUProfile,
  applyPerformanceProfile,
  type GPUPerformanceProfile,
  
  // Frame rate control
  createFrameRateController,
  type FrameRateController,
} from './performance';

// Memory profiling utilities
export {
  MemoryProfiler,
  getMemoryProfiler,
  deepDispose,
  TextureCache,
  GeometryPool,
  getMemoryPressure,
  requestMemoryCleanup,
  type MemorySnapshot,
  type MemoryDetails,
  type GeometryInfo,
  type TextureInfo,
  type MaterialInfo,
  type MemoryStats,
  type PotentialLeak,
} from './memoryProfiler';

// Navigation utilities
export {
  getNextLocation,
  getPreviousLocation,
  getLocationByOffset,
  calculateDistance,
  calculateBearing,
} from './navigation';
