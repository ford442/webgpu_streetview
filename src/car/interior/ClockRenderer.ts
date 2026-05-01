import * as THREE from 'three';

/**
 * Canvas-based digital clock texture updater.
 * Renders HH:MM to a CanvasTexture and assigns it to a dashboard mesh.
 */
export class ClockRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshStandardMaterial;
  private intervalId?: number;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
      emissiveMap: this.texture,
    });
  }

  getMaterial(): THREE.MeshStandardMaterial {
    return this.material;
  }

  /** Start updating the clock every second. */
  start(): void {
    this.draw();
    this.intervalId = window.setInterval(() => this.draw(), 1000);
  }

  /** Stop the update loop. */
  stop(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Subtle bezel
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    ctx.fillStyle = '#e0f0ff';
    ctx.font = 'bold 72px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${hh}:${mm}`, w / 2, h / 2);

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.stop();
    this.texture.dispose();
    this.material.dispose();
  }
}
