import * as THREE from 'three';
import { PanoLocationInfo, headingToCompass } from '../../utils/panoLocation';
import { createAccentMaterial } from './MaterialFactory';
import { VehicleConfig } from '../VehicleManager';

export type DisplayPage = 'nav' | 'media' | 'trip';
const PAGES: DisplayPage[] = ['nav', 'media', 'trip'];

/**
 * CenterDisplay — the infotainment screen on the centre stack.
 *
 * A gently curved screen mesh with a live CanvasTexture cycling through three
 * pages (navigation, media, trip computer), covered by a physical-glass
 * overlay whose clearcoat picks up the panorama IBL environment, so the
 * street reflects off the glossy surface with a natural Fresnel falloff.
 * An accent-colored frame provides the inner glow around the panel.
 *
 * Redraws are throttled to ~8 Hz and skipped entirely when the rendered
 * content hash hasn't changed (static page, no animation running).
 */
export class CenterDisplay {
    readonly group: THREE.Group;
    /** Raycast target for click-to-cycle interaction. */
    readonly screenMesh: THREE.Mesh;

    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private texture: THREE.CanvasTexture;
    private screenMat: THREE.MeshStandardMaterial;
    private accent: string;

    private page: DisplayPage = 'nav';
    private info: PanoLocationInfo | null = null;
    private headingDeg = 0;
    private mediaName = '';
    private mediaTags = '';
    private mediaPlaying = false;
    private speedKmh = 0;
    private rpm = 0;
    private odometerKm = 0;
    private driveTimeS = 0;

    private clock = 0;
    private sinceDraw = Infinity;
    private renderedKey = '';

    private static readonly W = 512;
    private static readonly H = 320;
    private static readonly REDRAW_INTERVAL = 0.125;

    constructor(vehicleConfig: VehicleConfig, gpuProfileName: string) {
        this.accent = vehicleConfig.accentColor || '#00ffcc';
        this.group = new THREE.Group();

        this.canvas = document.createElement('canvas');
        this.canvas.width = CenterDisplay.W;
        this.canvas.height = CenterDisplay.H;
        this.ctx = this.canvas.getContext('2d', { alpha: true })!;

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.anisotropy = gpuProfileName === 'high' ? 8 : 4;
        this.texture.colorSpace = THREE.SRGBColorSpace;

        const accentHex = parseInt(this.accent.replace('#', '0x')) || 0x00ffcc;
        this.screenMat = new THREE.MeshStandardMaterial({
            map: this.texture,
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: 0.55,
            emissiveMap: this.texture,
            roughness: 0.35,
            metalness: 0.0,
        });

        // Screen: subtle horizontal convex curve (centre ~5 mm proud) so
        // reflections sweep across it as the head moves.
        const screenGeo = CenterDisplay.curvedPlane(0.27, 0.17, 0.005);
        this.screenMesh = new THREE.Mesh(screenGeo, this.screenMat);
        this.screenMesh.name = 'centerDisplayScreen';
        this.group.add(this.screenMesh);

        // Glass cover: clearcoat + envMap → panorama reflections with
        // Fresnel edge falloff on top of the emissive content.
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xcfe0ea,
            metalness: 0,
            roughness: 0.05,
            transparent: true,
            opacity: 0.09,
            depthWrite: false,
            envMapIntensity: 1.6,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
        });
        const glass = new THREE.Mesh(CenterDisplay.curvedPlane(0.272, 0.172, 0.005), glassMat);
        glass.position.z = 0.003;
        this.group.add(glass);

        // Accent frame hugging the screen: the "inner glow" between the
        // screen edge and the dashboard bezel.
        const frameShape = CenterDisplay.roundedRect(0.288, 0.188, 0.012);
        frameShape.holes.push(new THREE.Path(CenterDisplay.roundedRect(0.276, 0.176, 0.008).getPoints(10)));
        const frame = new THREE.Mesh(
            new THREE.ShapeGeometry(frameShape),
            createAccentMaterial(vehicleConfig, 0.55)
        );
        frame.position.z = 0.002;
        this.group.add(frame);

        // Slightly below the housing centre: the dash-top roll overhangs
        // y≈1.0 at this depth and would clip the top row of the panel.
        this.group.position.set(0.15, 0.925, -0.726);
        this.render(true);
    }

    /** Plane with a gentle horizontal bulge toward +Z. */
    private static curvedPlane(w: number, h: number, depth: number): THREE.PlaneGeometry {
        const geo = new THREE.PlaneGeometry(w, h, 24, 1);
        const pos = geo.attributes.position;
        const half = w / 2;
        for (let i = 0; i < pos.count; i++) {
            const nx = pos.getX(i) / half;
            pos.setZ(i, (1 - nx * nx) * depth);
        }
        geo.computeVertexNormals();
        return geo;
    }

    private static roundedRect(w: number, h: number, r: number): THREE.Shape {
        const s = new THREE.Shape();
        s.moveTo(-w / 2 + r, -h / 2);
        s.lineTo(w / 2 - r, -h / 2);
        s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
        s.lineTo(w / 2, h / 2 - r);
        s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
        s.lineTo(-w / 2 + r, h / 2);
        s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
        s.lineTo(-w / 2, -h / 2 + r);
        s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
        return s;
    }

    // ------------------------------------------------------------------ data

    setLocation(info: PanoLocationInfo | null): void {
        this.info = info;
    }

    setHeading(heading: number): void {
        this.headingDeg = ((heading % 360) + 360) % 360;
    }

    setMedia(name: string, tags: string, playing: boolean): void {
        this.mediaName = name;
        this.mediaTags = tags;
        this.mediaPlaying = playing;
    }

    setTelemetry(speedKmh: number, rpm: number): void {
        this.speedKmh = speedKmh;
        this.rpm = rpm;
    }

    /** Boost the screen glow after dark (0 = day baseline, 1 = full night). */
    setNightGlow(night: number): void {
        this.screenMat.emissiveIntensity = 0.55 + Math.max(0, Math.min(1, night)) * 0.5;
    }

    /** Advance to the next page; returns the new page. */
    cyclePage(): DisplayPage {
        this.page = PAGES[(PAGES.indexOf(this.page) + 1) % PAGES.length];
        this.render(true);
        return this.page;
    }

    getPage(): DisplayPage {
        return this.page;
    }

    /** Screen-space hit test (approx until full projection is wired). */
    isHit(clientX: number, clientY: number): boolean {
        if (typeof window === 'undefined') return false;
        const w = window.innerWidth || 1280;
        const h = window.innerHeight || 720;
        const cx = w * 0.5;
        const cy = h * 0.58; // dash area
        const dx = Math.abs(clientX - cx);
        const dy = Math.abs(clientY - cy);
        return dx < Math.max(80, w * 0.16) && dy < Math.max(40, h * 0.10);
    }

    getMaterial(): THREE.MeshStandardMaterial {
        return this.screenMat;
    }

    /** Per-frame tick: integrates trip data and throttles canvas redraws. */
    update(dt: number): void {
        const clamped = Math.min(Math.max(dt, 0), 0.1);
        this.clock += clamped;
        if (this.speedKmh > 0.5) {
            this.odometerKm += (this.speedKmh / 3600) * clamped;
            this.driveTimeS += clamped;
        }
        this.sinceDraw += clamped;
        if (this.sinceDraw >= CenterDisplay.REDRAW_INTERVAL) {
            this.sinceDraw = 0;
            this.render();
        }
    }

    // -------------------------------------------------------------- painting

    private contentKey(): string {
        switch (this.page) {
            case 'nav':
                return [
                    'nav',
                    this.info?.address ?? this.info?.description ?? '',
                    Math.round(this.headingDeg / 2),
                ].join('|');
            case 'media':
                // Animated while playing → unique key every throttled frame.
                return ['media', this.mediaName, this.mediaTags,
                    this.mediaPlaying ? this.clock.toFixed(2) : 'off'].join('|');
            case 'trip':
                return ['trip', Math.round(this.speedKmh), Math.round(this.rpm / 50),
                    this.odometerKm.toFixed(2), Math.round(this.driveTimeS)].join('|');
        }
    }

    private render(force = false): void {
        const key = this.contentKey();
        if (!force && key === this.renderedKey) return;
        this.renderedKey = key;

        const ctx = this.ctx;
        const W = CenterDisplay.W;
        const H = CenterDisplay.H;
        const accent = this.accent;

        // Panel background with a vertical falloff like an LCD at an angle
        ctx.clearRect(0, 0, W, H);
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0b0e14');
        bg.addColorStop(1, '#05070b');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Faint pixel grid
        ctx.fillStyle = 'rgba(255,255,255,0.018)';
        for (let y = 12; y < H - 8; y += 8) {
            for (let x = 12; x < W - 8; x += 8) ctx.fillRect(x, y, 1, 1);
        }

        switch (this.page) {
            case 'nav': this.renderNav(); break;
            case 'media': this.renderMedia(); break;
            case 'trip': this.renderTrip(); break;
        }

        // Page indicator dots
        const dotY = H - 16;
        for (let i = 0; i < PAGES.length; i++) {
            const active = PAGES[i] === this.page;
            ctx.beginPath();
            ctx.arc(W / 2 + (i - 1) * 18, dotY, active ? 4 : 2.5, 0, Math.PI * 2);
            ctx.fillStyle = active ? accent : 'rgba(255,255,255,0.25)';
            ctx.shadowColor = accent;
            ctx.shadowBlur = active ? 8 : 0;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // Inner glow: accent bleed from the frame edges
        const glow = ctx.createLinearGradient(0, 0, 0, 14);
        glow.addColorStop(0, this.accentRgba(0.22));
        glow.addColorStop(1, this.accentRgba(0));
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, 14);
        const glowB = ctx.createLinearGradient(0, H, 0, H - 14);
        glowB.addColorStop(0, this.accentRgba(0.22));
        glowB.addColorStop(1, this.accentRgba(0));
        ctx.fillStyle = glowB;
        ctx.fillRect(0, H - 14, W, 14);

        // Painted Fresnel-style edge highlight along the top
        const sheen = ctx.createLinearGradient(0, 0, 0, H * 0.35);
        sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
        sheen.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(0, 0, W, H * 0.35);

        this.texture.needsUpdate = true;
    }

    private accentRgba(alpha: number): string {
        const hex = parseInt(this.accent.replace('#', '0x')) || 0x00ffcc;
        return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${alpha})`;
    }

    private header(title: string): void {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '600 18px "SF Mono", "Consolas", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(title, 28, 42);
        ctx.strokeStyle = this.accentRgba(0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(28, 54);
        ctx.lineTo(CenterDisplay.W - 28, 54);
        ctx.stroke();
    }

    private glowText(text: string, x: number, y: number, size: number, align: CanvasTextAlign = 'left', color?: string): void {
        const ctx = this.ctx;
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${size}px "SF Mono", "Consolas", monospace`;
        ctx.shadowColor = color ?? this.accent;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color ?? this.accent;
        ctx.fillText(text, x, y);
        ctx.shadowBlur = 0;
    }

    private fit(text: string, font: string, maxW: number): string {
        const ctx = this.ctx;
        ctx.font = font;
        if (ctx.measureText(text).width <= maxW) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
        return t + '…';
    }

    private renderNav(): void {
        const ctx = this.ctx;
        const W = CenterDisplay.W;
        this.header('NAVIGATION');

        const road = this.info?.address || this.info?.description || '— NO SIGNAL —';
        this.glowText(this.fit(road, '700 34px monospace', W - 56), 28, 104, 34);

        const coords = this.info?.lat != null && this.info?.lng != null
            ? `${this.info.lat.toFixed(5)}, ${this.info.lng.toFixed(5)}`
            : '—';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '600 20px "SF Mono", "Consolas", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(coords, 28, 140);

        // Compass ribbon: ticks every 15°, cardinal labels, sliding with heading.
        const ribbonY = 220;
        const pxPerDeg = 3.2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(28, ribbonY - 44, W - 56, 72);
        ctx.clip();
        for (let deg = -90; deg <= 90; deg += 15) {
            const worldDeg = Math.round((this.headingDeg + deg) / 15) * 15;
            const offset = worldDeg - this.headingDeg;
            const x = W / 2 + offset * pxPerDeg;
            const norm = ((worldDeg % 360) + 360) % 360;
            const isCardinal = norm % 90 === 0;
            ctx.strokeStyle = isCardinal ? this.accentRgba(0.9) : 'rgba(255,255,255,0.3)';
            ctx.lineWidth = isCardinal ? 2.5 : 1;
            ctx.beginPath();
            ctx.moveTo(x, ribbonY);
            ctx.lineTo(x, ribbonY + (isCardinal ? 18 : 10));
            ctx.stroke();
            if (isCardinal) {
                this.glowText('NESW'[Math.round(norm / 90) % 4], x, ribbonY - 8, 24, 'center');
            }
        }
        ctx.restore();
        // Centre marker
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W / 2, ribbonY + 24);
        ctx.lineTo(W / 2 - 6, ribbonY + 36);
        ctx.lineTo(W / 2 + 6, ribbonY + 36);
        ctx.closePath();
        ctx.stroke();
        this.glowText(`${headingToCompass(this.headingDeg)} ${Math.round(this.headingDeg)}°`, W / 2, ribbonY + 62, 22, 'center');
    }

    private renderMedia(): void {
        const ctx = this.ctx;
        const W = CenterDisplay.W;
        const H = CenterDisplay.H;
        this.header('MEDIA');

        const name = this.mediaName || 'RADIO OFF';
        this.glowText(this.fit(name, '700 30px monospace', W - 56), 28, 102, 30);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '600 18px "SF Mono", "Consolas", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(this.fit(this.mediaTags || '—', '600 18px monospace', W - 200), 28, 134);

        const status = this.mediaPlaying ? '▶ PLAYING' : '❚❚ STANDBY';
        this.glowText(status, W - 28, 134, 18, 'right', this.mediaPlaying ? undefined : 'rgba(255,255,255,0.45)');

        // Equaliser bars: pseudo-random but deterministic per bar + time.
        const bars = 24;
        const barW = (W - 76) / bars;
        const baseY = H - 52;
        for (let i = 0; i < bars; i++) {
            const level = this.mediaPlaying
                ? 0.18 + 0.82 * Math.abs(Math.sin(this.clock * (2.1 + (i % 7) * 0.63) + i * 1.7))
                : 0.06;
            const h = level * 96;
            const g = ctx.createLinearGradient(0, baseY - h, 0, baseY);
            g.addColorStop(0, this.accentRgba(0.95));
            g.addColorStop(1, this.accentRgba(0.25));
            ctx.fillStyle = g;
            ctx.fillRect(28 + i * barW + 2, baseY - h, barW - 4, h);
        }
    }

    private renderTrip(): void {
        const ctx = this.ctx;
        const W = CenterDisplay.W;
        this.header('TRIP COMPUTER');

        this.glowText(String(Math.round(this.speedKmh)), 158, 158, 84, 'right');
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '600 20px "SF Mono", "Consolas", monospace';
        ctx.textAlign = 'left';
        ctx.fillText('km/h', 172, 158);

        this.glowText(String(Math.round(this.rpm)), W - 96, 158, 44, 'right');
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '600 20px "SF Mono", "Consolas", monospace';
        ctx.textAlign = 'left';
        ctx.fillText('rpm', W - 84, 158);

        const label = (text: string, x: number, y: number) => {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '600 16px "SF Mono", "Consolas", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(text, x, y);
        };
        label('ODOMETER', 28, 212);
        this.glowText(`${this.odometerKm.toFixed(2)} km`, 28, 244, 26);

        const mins = Math.floor(this.driveTimeS / 60);
        const secs = Math.floor(this.driveTimeS % 60);
        label('DRIVE TIME', W / 2 + 28, 212);
        this.glowText(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`, W / 2 + 28, 244, 26);
    }

    dispose(): void {
        this.group.traverse(obj => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                (Array.isArray(obj.material) ? obj.material : [obj.material])
                    .forEach(m => m.dispose());
            }
        });
        this.texture.dispose();
    }
}
