import * as THREE from 'three';

/**
 * SunShafts — fake volumetric light shafts through the side windows.
 *
 * Two additive-blended gradient cards hang from each side window, leaning
 * into the cabin at the real sun's descent angle. They only appear when the
 * sun is low (golden hour, roughly 2°-25° altitude) and only on the side of
 * the car the sun is actually shining through, so they read as god rays
 * without any volumetric rendering cost: no lights, four transparent quads,
 * one shared geometry and texture.
 */
export class SunShafts {
    readonly group: THREE.Group;

    private leftPivot: THREE.Group;
    private rightPivot: THREE.Group;
    private leftMat: THREE.MeshBasicMaterial;
    private rightMat: THREE.MeshBasicMaterial;
    private texture: THREE.CanvasTexture;
    private geometry: THREE.PlaneGeometry;
    private clock = 0;

    /** Peak card opacity (per-side strength scales down from here). */
    private static readonly MAX_OPACITY = 0.14;

    constructor(private reducedMotion: boolean) {
        this.group = new THREE.Group();

        this.texture = SunShafts.buildShaftTexture();
        this.geometry = new THREE.PlaneGeometry(1.2, 1.15);

        const makeMaterial = () => new THREE.MeshBasicMaterial({
            map: this.texture,
            color: 0xffe3b8,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.leftMat = makeMaterial();
        this.rightMat = makeMaterial();

        this.leftPivot = SunShafts.buildSide(this.geometry, this.leftMat, -1);
        this.rightPivot = SunShafts.buildSide(this.geometry, this.rightMat, 1);
        this.group.add(this.leftPivot, this.rightPivot);
    }

    /** Streaky vertical gradient: bright at the window edge, fading inward. */
    private static buildShaftTexture(): THREE.CanvasTexture {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;

        const fade = ctx.createLinearGradient(0, 0, 0, 256);
        fade.addColorStop(0, 'rgba(255,255,255,0.9)');
        fade.addColorStop(0.55, 'rgba(255,255,255,0.35)');
        fade.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = fade;
        ctx.fillRect(0, 0, 128, 256);

        // Vertical streaks: soft bands like light through a dusty window.
        ctx.globalCompositeOperation = 'destination-out';
        for (let x = 0; x < 128; x += 4) {
            const cut = 0.15 + 0.75 * Math.abs(Math.sin(x * 0.55) * Math.cos(x * 0.21));
            ctx.fillStyle = `rgba(0,0,0,${cut})`;
            ctx.fillRect(x, 0, 4, 256);
        }
        ctx.globalCompositeOperation = 'source-over';

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        return tex;
    }

    /** Two offset cards hanging from one window's top edge. */
    private static buildSide(
        geometry: THREE.PlaneGeometry,
        material: THREE.MeshBasicMaterial,
        side: 1 | -1
    ): THREE.Group {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.92, 1.25, -0.1);
        for (const offset of [-0.03, 0.03]) {
            const card = new THREE.Mesh(geometry, material);
            // Plane normal along ±X so the card faces across the cabin;
            // geometry width runs along the car's length after this turn.
            card.rotation.y = Math.PI / 2;
            card.position.set(offset, -0.55, 0);
            pivot.add(card);
        }
        return pivot;
    }

    /**
     * Aim and fade the shafts from the real sun.
     * @param dt            frame delta (seconds)
     * @param sunAzimuth    SunCalc azimuth in radians (0 = south, positive west)
     * @param sunAltitude   SunCalc altitude in radians (0 = horizon)
     * @param carHeadingRad car body compass heading in radians
     * @param rain          0-1 rain intensity (overcast kills direct shafts)
     */
    public update(
        dt: number,
        sunAzimuth: number,
        sunAltitude: number,
        carHeadingRad: number,
        rain: number
    ): void {
        this.clock += Math.min(Math.max(dt, 0), 0.1);

        // Shafts exist in a low-sun band: ramp in above ~1°, gone by ~25°.
        const sinAlt = Math.sin(sunAltitude);
        const lowSun = sunAltitude <= 0.02
            ? 0
            : Math.min(1, sinAlt / 0.06) * Math.max(0, Math.min(1, 1 - (sinAlt - 0.1) / 0.32));

        // Sun direction in the car's frame: which window does it shine through?
        const sunHeading = sunAzimuth + Math.PI;
        const relative = sunHeading - carHeadingRad;
        const localX = Math.sin(relative) * Math.cos(sunAltitude);
        const rightStrength = Math.max(0, localX);
        const leftStrength = Math.max(0, -localX);

        const weather = 1 - Math.max(0, Math.min(1, rain)) * 0.85;
        const flicker = this.reducedMotion ? 1 : 1 + Math.sin(this.clock * 0.7) * 0.06;
        const base = SunShafts.MAX_OPACITY * lowSun * weather * flicker;

        this.leftMat.opacity = base * leftStrength;
        this.rightMat.opacity = base * rightStrength;
        this.leftPivot.visible = this.leftMat.opacity > 0.004;
        this.rightPivot.visible = this.rightMat.opacity > 0.004;

        // Lean the cards to the sun's descent angle (rays steepen as it rises),
        // pivoting at the window's top edge, plus a slow drift for life.
        const drift = this.reducedMotion ? 0 : Math.sin(this.clock * 0.23) * 0.015;
        const lean = Math.PI / 2 - Math.max(0.05, sunAltitude);
        this.leftPivot.rotation.z = lean + drift;
        this.rightPivot.rotation.z = -lean + drift;
    }

    public dispose(): void {
        this.geometry.dispose();
        this.texture.dispose();
        this.leftMat.dispose();
        this.rightMat.dispose();
    }
}
