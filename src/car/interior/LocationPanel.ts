import * as THREE from 'three';
import { PanoLocationInfo, headingToCompass } from '../../utils/panoLocation';

/**
 * LocationPanel
 *
 * A CanvasTexture dash panel (512×256) rendering the panorama's location:
 * road/area name, lat/lng, compass heading, and capture date, in a VFD
 * (vacuum-fluorescent-display) style to match the instrument cluster.
 *
 * Texture uploads are gated: the canvas is only redrawn (and `needsUpdate`
 * flipped) when the displayed content actually changes — the live compass
 * updates only when the heading crosses into a new 8-point sector, and the
 * location fields only change on a pano hop.
 */
export class LocationPanel {
  readonly mesh: THREE.Mesh;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshStandardMaterial;
  private accent: string;

  private info: PanoLocationInfo | null = null;
  private compass = 'N';
  private headingDeg = 0;
  /** Hash of the currently-rendered content, used to gate redraws/uploads. */
  private renderedKey = '';

  constructor(accentColor: string, gpuProfileName: string) {
    this.accent = accentColor || '#00ffcc';

    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.anisotropy = gpuProfileName === 'high' ? 8 : 4;
    this.texture.generateMipmaps = true;

    const accentHex = parseInt(this.accent.replace('#', '0x')) || 0x00ffcc;
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissive: new THREE.Color(accentHex),
      emissiveIntensity: 0.6,
      emissiveMap: this.texture,
      roughness: 0.28,
      metalness: 0.15,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });

    // 2:1 plane to match the 512×256 texture, seated on the centre dash.
    const geo = new THREE.PlaneGeometry(0.34, 0.17);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(0.06, 0.86, -0.7);
    this.mesh.rotation.set(-0.22, 0, 0);

    this.render(true);
  }

  /** Update the per-pano location fields (road/area, coords, date). */
  setLocation(info: PanoLocationInfo | null): void {
    this.info = info;
    this.render();
  }

  /** Update the live compass; only redraws when the 8-point sector changes. */
  setHeading(heading: number): void {
    this.headingDeg = ((heading % 360) + 360) % 360;
    const sector = headingToCompass(this.headingDeg);
    if (sector !== this.compass) {
      this.compass = sector;
      this.render();
    }
  }

  getMaterial(): THREE.MeshStandardMaterial {
    return this.material;
  }

  /** Boost the VFD glow after dark (0 = day baseline, 1 = full night). */
  setNightGlow(night: number): void {
    this.material.emissiveIntensity = 0.6 + Math.max(0, Math.min(1, night)) * 0.6;
  }

  private contentKey(): string {
    const i = this.info;
    return [
      i?.address ?? i?.description ?? '',
      i?.lat != null ? i.lat.toFixed(5) : '',
      i?.lng != null ? i.lng.toFixed(5) : '',
      i?.captureDate ?? '',
      this.compass,
      Math.round(this.headingDeg),
    ].join('|');
  }

  private render(force = false): void {
    const key = this.contentKey();
    if (!force && key === this.renderedKey) return;
    this.renderedKey = key;

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const accent = this.accent;

    // VFD background + faint dot grid
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#06080c';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for (let y = 14; y < H - 6; y += 8) {
      for (let x = 14; x < W - 6; x += 8) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Bezel
    ctx.strokeStyle = '#20242e';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(9, 9, W - 18, H - 18);

    const i = this.info;
    const road = i?.address || i?.description || null;
    const coords =
      i?.lat != null && i?.lng != null
        ? `${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}`
        : null;
    const date = i?.captureDate || null;

    const label = (text: string, x: number, y: number) => {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '600 15px "SF Mono", "Consolas", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x, y);
    };

    const glow = (
      text: string,
      x: number,
      y: number,
      size: number,
      align: CanvasTextAlign = 'left'
    ) => {
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${size}px "SF Mono", "Consolas", monospace`;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 12;
      ctx.fillStyle = accent;
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;
    };

    // Row 1 — road / area name (truncated to fit)
    label('LOCATION', 26, 46);
    glow(this.fit(road ?? '— NO SIGNAL —', 30, '700 30px monospace'), 26, 84, 30);

    // Row 2 — coordinates
    label('COORD', 26, 132);
    glow(coords ?? '—', 26, 168, 26);

    // Row 3 — heading (left) + capture date (right)
    label('HEADING', 26, 206);
    glow(`${this.compass}  ${Math.round(this.headingDeg)}°`, 26, 236, 26);

    label('CAPTURED', W - 190, 206);
    glow(date ?? '—', W - 26, 236, 26, 'right');

    this.texture.needsUpdate = true;
  }

  /** Trim a string until it fits the panel width at the given font. */
  private fit(text: string, _size: number, font: string): string {
    const ctx = this.ctx;
    ctx.font = font;
    const maxW = this.canvas.width - 52;
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.texture.dispose();
    this.material.dispose();
  }
}
