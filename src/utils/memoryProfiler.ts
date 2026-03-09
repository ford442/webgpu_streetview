/** @fileoverview Memory profiling and optimization utilities for Three.js/WebGPU */
import * as THREE from 'three';

// Type declarations for WebGPU
declare global {
  interface GPUDevice {
    createBuffer(descriptor: any): GPUBuffer;
    createTexture(descriptor: any): GPUTexture;
    queue: GPUQueue;
  }
  
  interface GPUBuffer {
    destroy(): void;
    size: number;
  }
  
  interface GPUTexture {
    destroy(): void;
    width: number;
    height: number;
    format: string;
  }
  
  interface GPUQueue {
    writeBuffer(buffer: GPUBuffer, offset: number, data: ArrayBufferView): void;
  }
}

// ============================================================
// Memory Tracking Types
// ============================================================

export interface MemorySnapshot {
  timestamp: number;
  geometryCount: number;
  textureCount: number;
  materialCount: number;
  estimatedBytes: number;
  details: MemoryDetails;
}

export interface MemoryDetails {
  geometries: GeometryInfo[];
  textures: TextureInfo[];
  materials: MaterialInfo[];
}

export interface GeometryInfo {
  name: string;
  uuid: string;
  vertexCount: number;
  indexCount: number;
  estimatedBytes: number;
}

export interface TextureInfo {
  name: string;
  uuid: string;
  width: number;
  height: number;
  format: string;
  estimatedBytes: number;
}

export interface MaterialInfo {
  name: string;
  uuid: string;
  type: string;
  textureCount: number;
}

export interface MemoryStats {
  current: MemorySnapshot;
  history: MemorySnapshot[];
  peak: MemorySnapshot;
  leaks: PotentialLeak[];
}

export interface PotentialLeak {
  type: 'geometry' | 'texture' | 'material';
  count: number;
  delta: number;
  timestamp: number;
}

// ============================================================
// Memory Profiler Class
// ============================================================

export class MemoryProfiler {
  private snapshots: MemorySnapshot[] = [];
  private maxHistorySize = 60; // Keep last 60 snapshots
  private trackedObjects = new Map<string, THREE.Object3D>();
  private lastSnapshotTime = 0;
  private snapshotInterval = 1000; // ms
  
  // WebGPU specific
  private gpuDevice?: GPUDevice;
  private gpuBuffers = new Map<string, number>();
  private gpuTextures = new Map<string, number>();
  
  constructor() {
    this.startAutoSnapshot();
  }
  
  /**
   * Set GPU device for WebGPU memory tracking
   */
  setGPUDevice(device: GPUDevice): void {
    this.gpuDevice = device;
  }
  
  /**
   * Take a memory snapshot
   */
  snapshot(scene?: THREE.Scene): MemorySnapshot {
    const timestamp = Date.now();
    const details: MemoryDetails = {
      geometries: [],
      textures: [],
      materials: []
    };
    
    const trackedGeometries = new Set<THREE.BufferGeometry>();
    const trackedTextures = new Set<THREE.Texture>();
    const trackedMaterials = new Set<THREE.Material>();
    
    // Helper to get geometry size
    const getGeometryInfo = (geo: THREE.BufferGeometry, name: string): GeometryInfo => {
      const position = geo.attributes.position;
      const vertexCount = position ? position.count : 0;
      const indexCount = geo.index ? geo.index.count : 0;
      
      // Estimate bytes: 3 floats per vertex for position + normals + uvs
      const bytesPerVertex = 3 * 4 + 3 * 4 + 2 * 4; // pos + normal + uv
      const vertexBytes = vertexCount * bytesPerVertex;
      const indexBytes = indexCount * 4; // 4 bytes per index (Uint32)
      
      return {
        name: name || geo.name || 'unnamed',
        uuid: geo.uuid,
        vertexCount,
        indexCount,
        estimatedBytes: vertexBytes + indexBytes
      };
    };
    
    // Helper to get texture size
    const getTextureInfo = (tex: THREE.Texture, name: string): TextureInfo => {
      const image = tex.image;
      const width = image?.width || image?.videoWidth || 0;
      const height = image?.height || image?.videoHeight || 0;
      
      // RGBA8 = 4 bytes per pixel
      const bytes = width * height * 4;
      
      return {
        name: name || tex.name || 'unnamed',
        uuid: tex.uuid,
        width,
        height,
        format: tex.format?.toString() || 'unknown',
        estimatedBytes: bytes
      };
    };
    
    // Helper to get material info
    const getMaterialInfo = (mat: THREE.Material, name: string): MaterialInfo => {
      let textureCount = 0;
      const matAny = mat as any;
      
      // Count common texture properties
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']
        .forEach(prop => {
          if (matAny[prop]) textureCount++;
        });
      
      return {
        name: name || mat.name || 'unnamed',
        uuid: mat.uuid,
        type: mat.type,
        textureCount
      };
    };
    
    // Scan scene if provided
    if (scene) {
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.SkinnedMesh) {
          if (obj.geometry && !trackedGeometries.has(obj.geometry)) {
            trackedGeometries.add(obj.geometry);
            details.geometries.push(getGeometryInfo(obj.geometry, obj.name + '_geo'));
          }
          
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach(mat => {
            if (mat && !trackedMaterials.has(mat)) {
              trackedMaterials.add(mat);
              details.materials.push(getMaterialInfo(mat, obj.name + '_mat'));
              
              // Extract textures from material
              const matAny = mat as any;
              ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']
                .forEach(prop => {
                  if (matAny[prop] && !trackedTextures.has(matAny[prop])) {
                    trackedTextures.add(matAny[prop]);
                    details.textures.push(getTextureInfo(matAny[prop], prop));
                  }
                });
            }
          });
        }
      });
    }
    
    // Calculate totals
    const geometryCount = trackedGeometries.size;
    const textureCount = trackedTextures.size;
    const materialCount = trackedMaterials.size;
    
    const estimatedBytes = 
      details.geometries.reduce((sum, g) => sum + g.estimatedBytes, 0) +
      details.textures.reduce((sum, t) => sum + t.estimatedBytes, 0);
    
    const snapshot: MemorySnapshot = {
      timestamp,
      geometryCount,
      textureCount,
      materialCount,
      estimatedBytes,
      details
    };
    
    this.snapshots.push(snapshot);
    
    // Trim history
    if (this.snapshots.length > this.maxHistorySize) {
      this.snapshots.shift();
    }
    
    this.lastSnapshotTime = timestamp;
    return snapshot;
  }
  
  /**
   * Get memory stats including history and peak usage
   */
  getStats(): MemoryStats {
    if (this.snapshots.length === 0) {
      return {
        current: this.snapshot(),
        history: [],
        peak: this.snapshot(),
        leaks: []
      };
    }
    
    const current = this.snapshots[this.snapshots.length - 1];
    
    // Find peak usage
    const peak = this.snapshots.reduce((max, snap) => 
      snap.estimatedBytes > max.estimatedBytes ? snap : max
    );
    
    // Detect potential memory leaks
    const leaks = this.detectLeaks();
    
    return {
      current,
      history: [...this.snapshots],
      peak,
      leaks
    };
  }
  
  /**
   * Detect potential memory leaks
   */
  private detectLeaks(): PotentialLeak[] {
    if (this.snapshots.length < 10) return [];
    
    const leaks: PotentialLeak[] = [];
    const recent = this.snapshots.slice(-10);
    const older = this.snapshots.slice(0, 10);
    
    // Compare averages
    const recentAvgGeo = recent.reduce((s, x) => s + x.geometryCount, 0) / recent.length;
    const olderAvgGeo = older.reduce((s, x) => s + x.geometryCount, 0) / older.length;
    
    const recentAvgTex = recent.reduce((s, x) => s + x.textureCount, 0) / recent.length;
    const olderAvgTex = older.reduce((s, x) => s + x.textureCount, 0) / older.length;
    
    if (recentAvgGeo > olderAvgGeo * 1.5) {
      leaks.push({
        type: 'geometry',
        count: Math.floor(recentAvgGeo),
        delta: Math.floor(recentAvgGeo - olderAvgGeo),
        timestamp: Date.now()
      });
    }
    
    if (recentAvgTex > olderAvgTex * 1.5) {
      leaks.push({
        type: 'texture',
        count: Math.floor(recentAvgTex),
        delta: Math.floor(recentAvgTex - olderAvgTex),
        timestamp: Date.now()
      });
    }
    
    return leaks;
  }
  
  /**
   * Start automatic snapshotting
   */
  private startAutoSnapshot(): void {
    setInterval(() => {
      if (Date.now() - this.lastSnapshotTime > this.snapshotInterval) {
        this.snapshot();
      }
    }, this.snapshotInterval);
  }
  
  /**
   * Get formatted memory string
   */
  static formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
  
  /**
   * Track a GPU buffer allocation
   */
  trackGPUBuffer(id: string, size: number): void {
    this.gpuBuffers.set(id, size);
  }
  
  /**
   * Untrack a GPU buffer
   */
  untrackGPUBuffer(id: string): void {
    this.gpuBuffers.delete(id);
  }
  
  /**
   * Get total GPU memory usage
   */
  getGPUMemoryUsage(): { buffers: number; textures: number; total: number } {
    const buffers = Array.from(this.gpuBuffers.values()).reduce((a, b) => a + b, 0);
    const textures = Array.from(this.gpuTextures.values()).reduce((a, b) => a + b, 0);
    return { buffers, textures, total: buffers + textures };
  }
  
  /**
   * Clear all history
   */
  clear(): void {
    this.snapshots = [];
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let globalProfiler: MemoryProfiler | null = null;

export function getMemoryProfiler(): MemoryProfiler {
  if (!globalProfiler) {
    globalProfiler = new MemoryProfiler();
  }
  return globalProfiler;
}

// ============================================================
// Memory Optimization Utilities
// ============================================================

/**
 * Dispose of a Three.js object and all its children
 */
export function deepDispose(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(mat => {
        if (mat) {
          // Dispose textures
          const matAny = mat as any;
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']
            .forEach(prop => {
              if (matAny[prop]) {
                matAny[prop].dispose();
              }
            });
          mat.dispose();
        }
      });
    }
  });
}

/**
 * Texture cache for reusing textures
 */
export class TextureCache {
  private cache = new Map<string, THREE.Texture>();
  private maxSize: number;
  
  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }
  
  get(key: string): THREE.Texture | undefined {
    return this.cache.get(key);
  }
  
  set(key: string, texture: THREE.Texture): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      const old = this.cache.get(firstKey);
      if (old) old.dispose();
      this.cache.delete(firstKey);
    }
    this.cache.set(key, texture);
  }
  
  clear(): void {
    this.cache.forEach(tex => tex.dispose());
    this.cache.clear();
  }
  
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Geometry pool for reusing geometry data
 */
export class GeometryPool {
  private pool = new Map<string, THREE.BufferGeometry>();
  private maxSize: number;
  
  constructor(maxSize: number = 20) {
    this.maxSize = maxSize;
  }
  
  get(key: string): THREE.BufferGeometry | undefined {
    return this.pool.get(key);
  }
  
  set(key: string, geometry: THREE.BufferGeometry): void {
    if (this.pool.size >= this.maxSize) {
      const firstKey = this.pool.keys().next().value;
      const old = this.pool.get(firstKey);
      if (old) old.dispose();
      this.pool.delete(firstKey);
    }
    this.pool.set(key, geometry);
  }
  
  clear(): void {
    this.pool.forEach(geo => geo.dispose());
    this.pool.clear();
  }
}

/**
 * Monitor browser memory pressure
 */
export function getMemoryPressure(): 'low' | 'normal' | 'high' | 'critical' {
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    if (memory) {
      const used = memory.usedJSHeapSize;
      const total = memory.totalJSHeapSize;
      const limit = memory.jsHeapSizeLimit;
      
      const ratio = used / limit;
      
      if (ratio > 0.9) return 'critical';
      if (ratio > 0.75) return 'high';
      if (ratio > 0.5) return 'normal';
    }
  }
  
  return 'low';
}

/**
 * Request garbage collection hint (if available)
 */
export function requestMemoryCleanup(): void {
  // Clear any image caches
  if ('caches' in window) {
    // Note: This is just a hint, actual cleanup is browser-controlled
  }
  
  // Trigger GC hint in some browsers
  if (globalThis.gc) {
    try {
      globalThis.gc();
    } catch {
      // Ignore
    }
  }
}
