import * as THREE from 'three';

export interface FrameMetrics {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/**
 * Lightweight runtime profiler for the car interior renderer.
 * Tracks FPS, frame time, and Three.js stats without heavy overhead.
 */
export class PerformanceProfiler {
  private renderer: THREE.WebGLRenderer;
  private lastTime = performance.now();
  private frameCount = 0;
  private metrics: FrameMetrics = {
    fps: 0,
    frameTime: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
  };
  private history: FrameMetrics[] = [];
  private readonly maxHistory = 60;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /** Call once per frame before rendering. */
  beginFrame(): void {
    this.renderer.info.reset();
  }

  /** Call once per frame after rendering. */
  endFrame(): void {
    const now = performance.now();
    this.frameCount++;

    const info = this.renderer.info;
    this.metrics.drawCalls = info.render.calls;
    this.metrics.triangles = info.render.triangles;
    this.metrics.geometries = info.memory.geometries;
    this.metrics.textures = info.memory.textures;

    // Update FPS every ~500ms
    if (now - this.lastTime >= 500) {
      const elapsed = (now - this.lastTime) / 1000;
      this.metrics.fps = Math.round(this.frameCount / elapsed);
      this.metrics.frameTime = elapsed / this.frameCount * 1000;
      this.frameCount = 0;
      this.lastTime = now;

      this.history.push({ ...this.metrics });
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
    }
  }

  getMetrics(): FrameMetrics {
    return { ...this.metrics };
  }

  getAverageFPS(): number {
    if (this.history.length === 0) return 0;
    return this.history.reduce((sum, m) => sum + m.fps, 0) / this.history.length;
  }

  getHistory(): readonly FrameMetrics[] {
    return this.history;
  }

  /** Format metrics as a concise string for debug overlay. */
  format(): string {
    const m = this.metrics;
    return `FPS:${m.fps} | ${m.frameTime.toFixed(1)}ms | DC:${m.drawCalls} | TRIS:${(m.triangles / 1000).toFixed(1)}k`;
  }
}
