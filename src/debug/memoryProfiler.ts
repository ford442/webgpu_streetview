/** @fileoverview Memory profiling and optimization utilities for Three.js/WebGPU */
// Type-only — this module is reachable from the eager pano bundle (perf
// overlays) as well as car mode, and must not pull the `three` runtime into
// that eager path. Object identity checks below use the `.isX` marker
// properties three.js sets on every instance instead of `instanceof`.
import type * as THREE from 'three';

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

interface MemoryDetails {
  geometries: GeometryInfo[];
  textures: TextureInfo[];
  materials: MaterialInfo[];
}

interface GeometryInfo {
  name: string;
  uuid: string;
  vertexCount: number;
  indexCount: number;
  estimatedBytes: number;
}

interface TextureInfo {
  name: string;
  uuid: string;
  width: number;
  height: number;
  format: string;
  estimatedBytes: number;
}

interface MaterialInfo {
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

const MATERIAL_TEXTURE_PROPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'] as const;

type MaterialTextureProp = (typeof MATERIAL_TEXTURE_PROPS)[number];

/** Read a named texture slot without `as any`. Missing slots are undefined. */
function readMaterialTexture(
  mat: THREE.Material,
  prop: MaterialTextureProp,
): THREE.Texture | undefined {
  const tex = (mat as THREE.MeshStandardMaterial)[prop];
  return isTexture(tex) ? tex : undefined;
}

/** `.isTexture`/`.isMesh` marker-property checks — avoid an `instanceof` (and the runtime `three` import that would require). */
function isTexture(value: unknown): value is THREE.Texture {
  return !!value && (value as { isTexture?: boolean }).isTexture === true;
}

function isMesh(value: unknown): value is THREE.Mesh {
  return !!value && (value as { isMesh?: boolean }).isMesh === true;
}

export class MemoryProfiler {
  private snapshots: MemorySnapshot[] = [];
  private maxHistorySize = 60; // Keep last 60 snapshots

  // WebGPU specific
  private gpuBuffers = new Map<string, number>();
  private gpuTextures = new Map<string, number>();

  
  /**
   * Set GPU device for WebGPU memory tracking
   */
  setGPUDevice(_device: GPUDevice): void {
    // Reserved for future WebGPU-side memory tracking; not yet consumed.
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
      MATERIAL_TEXTURE_PROPS.forEach((prop) => {
        if (readMaterialTexture(mat, prop)) textureCount++;
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
        if (isMesh(obj)) {
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
              MATERIAL_TEXTURE_PROPS.forEach((prop) => {
                const tex = readMaterialTexture(mat, prop);
                if (tex && !trackedTextures.has(tex)) {
                  trackedTextures.add(tex);
                  details.textures.push(getTextureInfo(tex, prop));
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
    
    // Include Three.js scene assets + tracked WebGPU resources
    const gpuMemory = this.getGPUMemoryUsage();
    const estimatedBytes = 
      details.geometries.reduce((sum, g) => sum + g.estimatedBytes, 0) +
      details.textures.reduce((sum, t) => sum + t.estimatedBytes, 0) +
      gpuMemory.total;
    
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
    
    // this.snapshots.length === 0 already returned above, so this index is always present.
    const current = this.snapshots[this.snapshots.length - 1]!;
    
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
   * Track a GPU texture allocation
   */
  trackGPUTexture(id: string, size: number): void {
    this.gpuTextures.set(id, size);
  }
  
  /**
   * Untrack a GPU texture
   */
  untrackGPUTexture(id: string): void {
    this.gpuTextures.delete(id);
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
