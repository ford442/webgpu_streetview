import * as THREE from 'three';
import type { PanoLocationInfo } from '../../utils/panoLocation';
import { getZonedClock } from '../../utils/localTime';
import { preloadTimeZoneLookup, resolveTimeZone } from '../../utils/panoTimeZone';

/**
 * DigitalClock
 *
 * The dash clock: a CanvasTexture plane showing the *panorama's* local time as
 * HH:MM:SS. The zone comes from the pano's lat/lng via an offline lookup
 * (`panoTimeZone`), so it is DST-correct and costs no Maps API calls. While the
 * zone is unknown (no coordinates, lookup still loading, lookup failed) it shows
 * the viewer's system time, as it did before panorama zones existed.
 *
 * This is the single owner of clock formatting and drawing. It has no timer:
 * `CarInterior.update()` calls `update()` every frame, which is a single integer
 * compare until the wall-clock second rolls over. The canvas is only redrawn
 * (and `needsUpdate` flipped) when the displayed string actually changes, so the
 * texture uploads at most once per second.
 */
export class DigitalClock {
  readonly mesh: THREE.Mesh;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshStandardMaterial;
  private accent: string;

  private timeZone: string | null = null;
  /** Whole epoch second last formatted; the per-frame fast path compares this. */
  private renderedSec = Number.NaN;
  /** Currently-drawn text, used to gate redraws/uploads. */
  private renderedKey = '';
  /** Set when the zone changes so the next update() reformats within the same second. */
  private dirty = false;
  /** Coordinates the zone was last requested for; skips redundant lookups. */
  private locationKey = '';
  /** Bumped per setLocation so a late lookup for an older pano is discarded. */
  private locationToken = 0;
  private disposed = false;

  constructor(accentColor: string, gpuProfileName: string) {
    this.accent = accentColor || '#00ffcc';

    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 80;
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.anisotropy = gpuProfileName === 'high' ? 8 : 4;
    this.texture.generateMipmaps = true;

    const accentHex = parseInt(this.accent.replace('#', '0x')) || 0x00ffcc;
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissive: new THREE.Color(accentHex),
      emissiveIntensity: 0.75,
      emissiveMap: this.texture,
      roughness: 0.25,
      metalness: 0.15,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.072), this.material);
    this.mesh.position.set(0.42, 0.91, -0.732);
    this.mesh.rotation.set(-0.18, 0, 0);

    // Warm the zone-lookup chunk so it is ready before the first pano arrives.
    void preloadTimeZoneLookup();
    this.update();
  }

  getMaterial(): THREE.MeshStandardMaterial {
    return this.material;
  }

  /**
   * Re-derive the zone for a new panorama. The previous zone stays on screen
   * until the new one resolves (no flash of system time between hops);
   * missing coordinates fall back to system time immediately.
   */
  setLocation(info: PanoLocationInfo | null): void {
    const lat = info?.lat ?? null;
    const lng = info?.lng ?? null;
    if (lat == null || lng == null) {
      this.locationKey = '';
      this.locationToken++;
      this.setTimeZone(null);
      return;
    }

    const key = `${lat},${lng}`;
    if (key === this.locationKey) return;
    this.locationKey = key;

    const token = ++this.locationToken;
    void resolveTimeZone(lat, lng).then((zone) => {
      if (this.disposed || token !== this.locationToken) return;
      this.setTimeZone(zone);
    });
  }

  /** Set the IANA zone directly (null = viewer's system time). */
  setTimeZone(timeZone: string | null): void {
    if (timeZone === this.timeZone) return;
    this.timeZone = timeZone;
    this.dirty = true;
  }

  /** Per-frame tick. Redraws + uploads only when the displayed time changes. */
  update(nowMs: number = Date.now()): void {
    if (this.disposed) return;
    const sec = Math.floor(nowMs / 1000);
    if (!this.dirty && sec === this.renderedSec) return;
    this.renderedSec = sec;
    this.dirty = false;

    const { hh, mm, ss } = getZonedClock(nowMs, this.timeZone);
    const key = `${hh}:${mm}:${ss}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;

    // Blinking separators, as before; free because the key already changes each second.
    const sep = Number(ss) % 2 === 0 ? ':' : ' ';
    this.draw(`${hh}${sep}${mm}${sep}${ss}`);
    this.texture.needsUpdate = true;
  }

  private draw(text: string): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let x = 8; x < W; x += 6) {
      ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, H - 6); ctx.stroke();
    }
    for (let y = 8; y < H; y += 6) {
      ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(W - 6, y); ctx.stroke();
    }

    const bevel = ctx.createLinearGradient(0, 0, 0, H);
    bevel.addColorStop(0,    'rgba(255,255,255,0.12)');
    bevel.addColorStop(0.12, 'rgba(0,0,0,0.45)');
    bevel.addColorStop(0.88, 'rgba(0,0,0,0.45)');
    bevel.addColorStop(1,    'rgba(255,255,255,0.08)');
    ctx.fillStyle = bevel;
    ctx.fillRect(6, 6, W - 12, H - 12);

    ctx.shadowColor = this.accent;
    ctx.shadowBlur = 14;
    ctx.fillStyle = this.accent;
    // 8 monospace glyphs at 40px ≈ 192px: clears the 5-9px bezel on a 256px canvas.
    ctx.font = '700 40px "Courier New", "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2 + 0.5, H / 2 + 1.5);

    ctx.shadowBlur = 0;
    ctx.fillText(text, W / 2, H / 2 + 1);

    ctx.strokeStyle = '#2a2a38';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    ctx.strokeStyle = '#555566';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(5, 5, W - 10, H - 10);

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(W - 8, 8); ctx.stroke();
  }

  dispose(): void {
    this.disposed = true;
    this.locationToken++;
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
