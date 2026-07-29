import * as THREE from 'three';
import type { VehicleConfig } from '../VehicleManager';
import { resolveGaugeLayout, type GaugeLayoutConfig } from '../vehicleLayout';

export const SPEED_DIAL_MAX_KMH = 180;
export const TACHO_DIAL_MAX_RPM = 8000;
export const TACHO_REDLINE_RPM = 6500;

/**
 * Default instrument-cluster layout (metres, driver-camera local space).
 * Prefer `resolveGaugeLayout(vehicleConfig)` at build time for per-vehicle placement.
 * Dashboard bezel/rings in CarInteriorDashboardBuilder must stay in sync.
 */
export const GAUGE_LAYOUT: GaugeLayoutConfig = {
  speed: { x: -0.48, y: 0.70, z: -0.84 },
  tacho: { x: -0.18, y: 0.70, z: -0.84 },
  fuel: { x: -0.42, y: 0.58, z: -0.84 },
  temp: { x: -0.24, y: 0.58, z: -0.84 },
  dialRadius: 0.085,
  needleLength: 0.066,
  coverRadius: 0.09,
  hubRadius: 0.007,
  needleZ: 0.006,
  hubZ: 0.009,
  coverZ: 0.017,
};

/**
 * Map a 0..1 dial fraction to needle rotation.z.
 * Dials sweep 270° clockwise from lower-left (7:30) to lower-right (4:30);
 * a needle mesh pointing +Y at rotation 0 therefore starts at +135°.
 */
export function needleAngle(frac: number): number {
    const clamped = Math.max(0, Math.min(1, frac));
    return THREE.MathUtils.degToRad(135 - clamped * 270);
}

/** Live handles the animator uses to drive needles and backlighting. */
export interface GaugeRig {
    speedNeedle: THREE.Mesh;
    tachoNeedle: THREE.Mesh;
    fuelNeedle: THREE.Mesh | null;
    tempNeedle: THREE.Mesh | null;
    /** Dial-face materials whose emissiveIntensity is pulsed for backlight. */
    dialMaterials: THREE.MeshStandardMaterial[];
    /** Needle materials whose emissive glow tracks night/engine state. */
    needleMaterials: THREE.MeshStandardMaterial[];
}

export interface CarInteriorGaugeResult {
    speedometerNeedle: THREE.Mesh;
    tachometerNeedle: THREE.Mesh;
    gaugeRig: GaugeRig;
    digitalClockMesh?: THREE.Mesh;
    clockCanvas?: HTMLCanvasElement;
    clockCtx?: CanvasRenderingContext2D;
    clockUpdateInterval?: number;
}

interface DialSpec {
    emissiveColor: string;
    /** Labels placed at major ticks, evenly across the sweep. */
    majorLabels: string[];
    minorTicksPerMajor: number;
    unit: string;
    /** Fraction of the sweep where the red zone begins. */
    redlineFrac?: number;
}

/** Dial sweep in canvas coordinates: 270° clockwise starting at lower-left. */
const DIAL_START = Math.PI * 0.75;
const DIAL_SWEEP = Math.PI * 1.5;

export class CarInteriorGauges {
    static build(
        interiorGroup: THREE.Group,
        _metalMaterial: THREE.MeshStandardMaterial,
        vehicleConfig: VehicleConfig,
        gpuProfile: { name: string },
        quality: 'high' | 'medium' | 'low'
    ): CarInteriorGaugeResult {
        const layout = resolveGaugeLayout(vehicleConfig);
        const result = CarInteriorGauges.buildGauges(interiorGroup, vehicleConfig, gpuProfile, quality, layout);
        if (quality !== 'low') {
            const clock = CarInteriorGauges.buildDigitalClock(interiorGroup, vehicleConfig, gpuProfile);
            return {
                ...result,
                ...clock,
            };
        }
        return result;
    }

    /**
     * Paint a dial face. Rendered at 2× the display request and left to
     * mipmapping + anisotropy so ticks and numerals stay crisp at an angle.
     */
    private static buildDialCanvas(size: number, spec: DialSpec): HTMLCanvasElement {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d')!;
        const cx = size / 2;
        const r = size / 2;

        const bg = ctx.createRadialGradient(cx, cx, 0, cx, cx, r);
        bg.addColorStop(0, '#242428');
        bg.addColorStop(0.75, '#141416');
        bg.addColorStop(1, '#08080a');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(cx, cx, r, 0, Math.PI * 2);
        ctx.fill();

        // Glancing sheen from upper-left, like light on a recessed dial.
        const sheen = ctx.createLinearGradient(0, 0, size, size);
        sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
        sheen.addColorStop(0.35, 'rgba(255,255,255,0.0)');
        ctx.fillStyle = sheen;
        ctx.beginPath();
        ctx.arc(cx, cx, r - 2, 0, Math.PI * 2);
        ctx.fill();

        // Accent rim ring
        ctx.strokeStyle = spec.emissiveColor;
        ctx.lineWidth = Math.max(2, size * 0.012);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(cx, cx, r - size * 0.02, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        // Red zone arc
        if (spec.redlineFrac !== undefined) {
            ctx.strokeStyle = '#e01818';
            ctx.lineWidth = size * 0.028;
            ctx.beginPath();
            ctx.arc(cx, cx, r - size * 0.055, DIAL_START + spec.redlineFrac * DIAL_SWEEP, DIAL_START + DIAL_SWEEP);
            ctx.stroke();
        }

        const majorCount = spec.majorLabels.length - 1;
        const minorTicks = majorCount * spec.minorTicksPerMajor;
        for (let i = 0; i <= minorTicks; i++) {
            const frac = i / minorTicks;
            const a = DIAL_START + frac * DIAL_SWEEP;
            const isMajor = i % spec.minorTicksPerMajor === 0;
            const inRedline = spec.redlineFrac !== undefined && frac >= spec.redlineFrac;
            const inner = isMajor ? r - size * 0.085 : r - size * 0.058;
            const outer = r - size * 0.03;
            ctx.strokeStyle = inRedline ? '#ff4040' : isMajor ? spec.emissiveColor : 'rgba(255,255,255,0.4)';
            ctx.lineWidth = isMajor ? Math.max(2, size * 0.012) : Math.max(1, size * 0.005);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * inner, cx + Math.sin(a) * inner);
            ctx.lineTo(cx + Math.cos(a) * outer, cx + Math.sin(a) * outer);
            ctx.stroke();

            if (isMajor) {
                const labelRadius = r - size * 0.16;
                const label = spec.majorLabels[i / spec.minorTicksPerMajor]!;
                ctx.fillStyle = inRedline ? '#ff6060' : 'rgba(255,255,255,0.85)';
                ctx.font = `bold ${Math.round(size * 0.09)}px "Arial Narrow", Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, cx + Math.cos(a) * labelRadius, cx + Math.sin(a) * labelRadius);
            }
        }

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `${Math.round(size * 0.075)}px "Arial Narrow", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(spec.unit, cx, cx + size * 0.24);

        // Hub
        ctx.fillStyle = '#151517';
        ctx.beginPath();
        ctx.arc(cx, cx, size * 0.075, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = spec.emissiveColor;
        ctx.lineWidth = Math.max(1.5, size * 0.007);
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.arc(cx, cx, size * 0.075, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        return c;
    }

    private static buildDialMesh(
        canvas: HTMLCanvasElement,
        radius: number,
        emissive: number,
        anisotropy: number
    ): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = anisotropy;
        tex.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.7,
            emissive: new THREE.Color(emissive),
            emissiveIntensity: 0.25,
            emissiveMap: tex,
        });
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), material);
        return { mesh, material };
    }

    /**
     * Tapered flat needle pivoting at the hub, with a short counterweight
     * tail. rotation.z spins it around the gauge center.
     */
    private static buildNeedle(
        length: number,
        color: number
    ): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
        const halfBase = length * 0.055;
        const shape = new THREE.Shape();
        shape.moveTo(-halfBase, -length * 0.22);
        shape.lineTo(halfBase, -length * 0.22);
        shape.lineTo(halfBase * 0.22, length);
        shape.lineTo(-halfBase * 0.22, length);
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        const material = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 1.0,
            roughness: 0.4,
            metalness: 0.1,
        });
        const mesh = new THREE.Mesh(geo, material);
        return { mesh, material };
    }

    private static buildGauges(
        interiorGroup: THREE.Group,
        _vehicleConfig: { accentColor: string },
        gpuProfile: { name: string },
        quality: 'high' | 'medium' | 'low',
        layout: GaugeLayoutConfig,
    ): { speedometerNeedle: THREE.Mesh; tachometerNeedle: THREE.Mesh; gaugeRig: GaugeRig } {
        const dialSize = gpuProfile.name === 'high' ? 512 : 256;
        const anisotropy = gpuProfile.name === 'high' ? 8 : 4;
        const dialMaterials: THREE.MeshStandardMaterial[] = [];
        const needleMaterials: THREE.MeshStandardMaterial[] = [];
        const L = layout;

        const speedLabels: string[] = [];
        for (let v = 0; v <= SPEED_DIAL_MAX_KMH; v += 30) speedLabels.push(String(v));
        const speedDial = CarInteriorGauges.buildDialMesh(
            CarInteriorGauges.buildDialCanvas(dialSize, {
                emissiveColor: '#00dd88',
                majorLabels: speedLabels,
                minorTicksPerMajor: 5,
                unit: 'km/h',
            }),
            L.dialRadius, 0x002211, anisotropy
        );
        speedDial.mesh.position.set(L.speed.x, L.speed.y, L.speed.z);
        interiorGroup.add(speedDial.mesh);
        dialMaterials.push(speedDial.material);

        const speedNeedle = CarInteriorGauges.buildNeedle(L.needleLength, 0xff5030);
        speedNeedle.mesh.position.set(L.speed.x, L.speed.y, L.speed.z + L.needleZ);
        speedNeedle.mesh.rotation.z = needleAngle(0);
        interiorGroup.add(speedNeedle.mesh);
        needleMaterials.push(speedNeedle.material);

        const tachoLabels: string[] = [];
        for (let v = 0; v <= 8; v++) tachoLabels.push(String(v));
        const tachoDial = CarInteriorGauges.buildDialMesh(
            CarInteriorGauges.buildDialCanvas(dialSize, {
                emissiveColor: '#dd4422',
                majorLabels: tachoLabels,
                minorTicksPerMajor: 4,
                unit: 'x1000',
                redlineFrac: TACHO_REDLINE_RPM / TACHO_DIAL_MAX_RPM,
            }),
            L.dialRadius, 0x220800, anisotropy
        );
        tachoDial.mesh.position.set(L.tacho.x, L.tacho.y, L.tacho.z);
        interiorGroup.add(tachoDial.mesh);
        dialMaterials.push(tachoDial.material);

        const tachoNeedle = CarInteriorGauges.buildNeedle(L.needleLength, 0xff5030);
        tachoNeedle.mesh.position.set(L.tacho.x, L.tacho.y, L.tacho.z + L.needleZ);
        tachoNeedle.mesh.rotation.z = needleAngle(0);
        interiorGroup.add(tachoNeedle.mesh);
        needleMaterials.push(tachoNeedle.material);

        // Fuel + coolant-temperature mini gauges below the main pair.
        let fuelNeedleMesh: THREE.Mesh | null = null;
        let tempNeedleMesh: THREE.Mesh | null = null;
        if (quality !== 'low') {
            const miniSize = dialSize / 2;
            const miniRadius = L.dialRadius * 0.38;
            const miniNeedle = L.needleLength * 0.38;
            const fuelDial = CarInteriorGauges.buildDialMesh(
                CarInteriorGauges.buildDialCanvas(miniSize, {
                    emissiveColor: '#ffaa00',
                    majorLabels: ['E', '½', 'F'],
                    minorTicksPerMajor: 2,
                    unit: 'FUEL',
                }),
                miniRadius, 0x221400, anisotropy
            );
            fuelDial.mesh.position.set(L.fuel.x, L.fuel.y, L.fuel.z);
            interiorGroup.add(fuelDial.mesh);
            dialMaterials.push(fuelDial.material);

            const fuelNeedle = CarInteriorGauges.buildNeedle(miniNeedle, 0xffaa30);
            fuelNeedle.mesh.position.set(L.fuel.x, L.fuel.y, L.fuel.z + L.needleZ);
            fuelNeedle.mesh.rotation.z = needleAngle(0.85);
            interiorGroup.add(fuelNeedle.mesh);
            needleMaterials.push(fuelNeedle.material);
            fuelNeedleMesh = fuelNeedle.mesh;

            const tempDial = CarInteriorGauges.buildDialMesh(
                CarInteriorGauges.buildDialCanvas(miniSize, {
                    emissiveColor: '#44aaff',
                    majorLabels: ['C', '', 'H'],
                    minorTicksPerMajor: 2,
                    unit: 'TEMP',
                    redlineFrac: 0.86,
                }),
                miniRadius, 0x081422, anisotropy
            );
            tempDial.mesh.position.set(L.temp.x, L.temp.y, L.temp.z);
            interiorGroup.add(tempDial.mesh);
            dialMaterials.push(tempDial.material);

            const tempNeedle = CarInteriorGauges.buildNeedle(miniNeedle, 0x60b8ff);
            tempNeedle.mesh.position.set(L.temp.x, L.temp.y, L.temp.z + L.needleZ);
            tempNeedle.mesh.rotation.z = needleAngle(0.05);
            interiorGroup.add(tempNeedle.mesh);
            needleMaterials.push(tempNeedle.material);
            tempNeedleMesh = tempNeedle.mesh;
        }

        // Chrome hub caps over the needle pivots.
        const hubMat = new THREE.MeshPhysicalMaterial({
            color: 0xd8d8dc, metalness: 1, roughness: 0.12,
            clearcoat: 1, clearcoatRoughness: 0.08,
        });
        const hubGeo = new THREE.CircleGeometry(L.hubRadius, 24);
        for (const pos of [L.speed, L.tacho] as const) {
            const hub = new THREE.Mesh(hubGeo, hubMat);
            hub.position.set(pos.x, pos.y, pos.z + L.hubZ);
            interiorGroup.add(hub);
        }

        // Physical-glass covers over the gauge faces so they pick up the
        // panorama environment reflections like real instrument glass.
        const coverMat = new THREE.MeshPhysicalMaterial({
            color: 0xdde8f0,
            metalness: 0,
            roughness: 0.04,
            transparent: true,
            opacity: 0.08,
            depthWrite: false,
            envMapIntensity: 1.4,
            clearcoat: 1.0,
            clearcoatRoughness: 0.06,
        });
        const coverGeo = new THREE.CircleGeometry(L.coverRadius, 32);
        const speedoCover = new THREE.Mesh(coverGeo, coverMat);
        speedoCover.name = 'gaugeCoverSpeedo';
        speedoCover.position.set(L.speed.x, L.speed.y, L.speed.z + L.coverZ);
        interiorGroup.add(speedoCover);
        const tachoCover = new THREE.Mesh(coverGeo, coverMat);
        tachoCover.name = 'gaugeCoverTacho';
        tachoCover.position.set(L.tacho.x, L.tacho.y, L.tacho.z + L.coverZ);
        interiorGroup.add(tachoCover);

        return {
            speedometerNeedle: speedNeedle.mesh,
            tachometerNeedle: tachoNeedle.mesh,
            gaugeRig: {
                speedNeedle: speedNeedle.mesh,
                tachoNeedle: tachoNeedle.mesh,
                fuelNeedle: fuelNeedleMesh,
                tempNeedle: tempNeedleMesh,
                dialMaterials,
                needleMaterials,
            },
        };
    }

    private static buildDigitalClock(
        interiorGroup: THREE.Group,
        vehicleConfig: { accentColor: string },
        gpuProfile: { name: string }
    ): { digitalClockMesh: THREE.Mesh; clockCanvas: HTMLCanvasElement; clockCtx: CanvasRenderingContext2D; clockUpdateInterval: number } {
        const clockCanvas = document.createElement('canvas');
        clockCanvas.width = 256;
        clockCanvas.height = 80;
        const clockCtx = clockCanvas.getContext('2d', { alpha: true })!;

        const clockTexture = new THREE.CanvasTexture(clockCanvas);
        clockTexture.anisotropy = gpuProfile.name === 'high' ? 8 : 4;
        clockTexture.generateMipmaps = true;

        const accentHex = parseInt(vehicleConfig.accentColor.replace('#', '0x'));
        const clockMaterial = new THREE.MeshStandardMaterial({
            map: clockTexture,
            emissive: new THREE.Color(accentHex),
            emissiveIntensity: 0.75,
            emissiveMap: clockTexture,
            roughness: 0.25,
            metalness: 0.15,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
        });

        const clockGeo = new THREE.PlaneGeometry(0.22, 0.072);
        const digitalClockMesh = new THREE.Mesh(clockGeo, clockMaterial);
        digitalClockMesh.position.set(0.42, 0.91, -0.732);
        digitalClockMesh.rotation.set(-0.18, 0, 0);
        interiorGroup.add(digitalClockMesh);

        CarInteriorGauges.updateDigitalClock(clockCtx, clockCanvas, digitalClockMesh, vehicleConfig.accentColor);
        const clockUpdateInterval = window.setInterval(() => {
            CarInteriorGauges.updateDigitalClock(clockCtx, clockCanvas, digitalClockMesh, vehicleConfig.accentColor);
        }, 500);

        return { digitalClockMesh, clockCanvas, clockCtx, clockUpdateInterval };
    }

    static updateDigitalClock(
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        mesh: THREE.Mesh,
        accentColor: string
    ): void {
        const W = canvas.width;
        const H = canvas.height;

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

        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        const colonVisible = (now.getSeconds() % 2) === 0;
        const timeString = colonVisible ? `${hh}:${mm}` : `${hh} ${mm}`;

        const color = accentColor || '#00ffcc';

        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = color;
        ctx.font = '700 46px "Courier New", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(timeString, W / 2 + 0.5, H / 2 + 1.5);

        ctx.shadowBlur = 0;
        ctx.fillText(timeString, W / 2, H / 2 + 1);

        ctx.strokeStyle = '#2a2a38';
        ctx.lineWidth = 3;
        ctx.strokeRect(3, 3, W - 6, H - 6);

        ctx.strokeStyle = '#555566';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(5, 5, W - 10, H - 10);

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(W - 8, 8); ctx.stroke();

        const clockMat = mesh.material as THREE.MeshStandardMaterial;
        if (clockMat.map) clockMat.map.needsUpdate = true;
    }
}
