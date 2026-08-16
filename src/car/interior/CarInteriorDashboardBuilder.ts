import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { resolveGaugeLayout } from '../vehicleLayout';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import { createAccentMaterial, registerGlowMaterial } from './MaterialFactory';
import type { CarInteriorMaterials } from './CarInteriorBuilder';
import { createCabinGlowSprite, type CabinGlowSprite } from './CabinEmitterGlow';

export class CarInteriorDashboardBuilder {
    /** Radial/tubular segment counts scale with quality tier. */
    private readonly segments: number;

    constructor(
        private interiorGroup: THREE.Group,
        private materials: CarInteriorMaterials,
        private vehicleConfig: VehicleConfig,
        private quality: 'high' | 'medium' | 'low',
        private geometryFactory: GeometryFactory,
        private lodManager: LODManager,
        private reducedMotion: boolean = false,
    ) {
        this.segments = quality === 'high' ? 48 : quality === 'medium' ? 24 : 12;
    }

    public build(): {
        instrumentClusterMat: THREE.MeshStandardMaterial;
        centerDisplayMat: THREE.MeshStandardMaterial;
        glowSprites: CabinGlowSprite[];
    } {
        const gaugeLayout = resolveGaugeLayout(this.vehicleConfig);
        const dashGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
        const dash = new THREE.Mesh(dashGeo, this.materials.dashboard);
        dash.position.set(0, 0.8, -1.0);
        this.interiorGroup.add(dash);

        const dashTopGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.0, this.segments, 1, false, 0, Math.PI);
        const dashTop = new THREE.Mesh(dashTopGeo, this.materials.dashboard);
        dashTop.rotation.set(0, 0, Math.PI / 2);
        dashTop.position.set(0, 1.0, -0.85);
        this.interiorGroup.add(dashTop);

        const accentHex = parseInt(this.vehicleConfig.accentColor.replace('#', '0x'));
        // Instrument cluster: dark well with a green backlight that the lighting
        // manager raises at night. Keep emissive in-family with the HUD, not cyan.
        const clusterMat = new THREE.MeshStandardMaterial({
            color: 0x030805,
            emissive: accentHex,
            emissiveIntensity: 0.2,
            roughness: 0.55,
            metalness: 0.05,
        });
        const clusterW =
            Math.abs(gaugeLayout.tacho.x - gaugeLayout.speed.x) + gaugeLayout.dialRadius * 2 + 0.06;
        const clusterH = gaugeLayout.dialRadius * 2 + 0.06;
        const clusterCx = (gaugeLayout.speed.x + gaugeLayout.tacho.x) / 2;
        const cluster = new THREE.Mesh(new THREE.BoxGeometry(clusterW, clusterH, 0.04), clusterMat);
        cluster.position.set(clusterCx, gaugeLayout.speed.y, gaugeLayout.speed.z - 0.02);
        this.interiorGroup.add(cluster);

        const displayMat = new THREE.MeshStandardMaterial({
            color: 0x040808,
            emissive: accentHex,
            emissiveIntensity: 0.24,
            roughness: 0.4,
            metalness: 0.02,
        });
        const display = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.02), displayMat);
        display.position.set(0.15, 0.925, -0.74);
        this.interiorGroup.add(display);

        const glowSprites: CabinGlowSprite[] = [];

        if (this.quality !== 'low') {
            const clusterBezelW =
                Math.abs(gaugeLayout.tacho.x - gaugeLayout.speed.x) + gaugeLayout.dialRadius * 2 + 0.08;
            const clusterBezelH = gaugeLayout.dialRadius * 2 + 0.08;
            const clusterBezel = new THREE.Mesh(
                this.makeBezelFrameGeometry(clusterBezelW, clusterBezelH, 0.024),
                this.materials.dashboard,
            );
            clusterBezel.position.set(clusterCx, gaugeLayout.speed.y, gaugeLayout.speed.z - 0.016);
            this.interiorGroup.add(clusterBezel);

            const displayBezel = new THREE.Mesh(this.makeBezelFrameGeometry(0.34, 0.24, 0.025), this.materials.dashboard);
            displayBezel.position.set(0.15, 0.925, -0.741);
            this.interiorGroup.add(displayBezel);

            const stripMat = createAccentMaterial(this.vehicleConfig, 0.25);
            const trim = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.008, 0.012), stripMat);
            trim.position.set(0, 1.005, -0.86);
            this.interiorGroup.add(trim);

            const lowerStripMat = createAccentMaterial(this.vehicleConfig, 0.12);
            const lowerTrim = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.006, 0.01), lowerStripMat);
            lowerTrim.position.set(0, 0.625, -0.99);
            this.interiorGroup.add(lowerTrim);

            const ringMat = createAccentMaterial(this.vehicleConfig, 0.45);
            const ringGeo = new THREE.TorusGeometry(
                gaugeLayout.dialRadius + 0.008,
                0.006,
                12,
                this.segments,
            );
            for (const pos of [gaugeLayout.speed, gaugeLayout.tacho]) {
                const bezelRing = new THREE.Mesh(ringGeo, ringMat);
                bezelRing.position.set(pos.x, pos.y, pos.z + 0.004);
                this.interiorGroup.add(bezelRing);
            }

            const clusterGlow = createCabinGlowSprite({
                kind: 'cluster',
                color: accentHex,
                width: clusterBezelW * 1.15,
                height: clusterBezelH * 1.35,
                useShader: this.quality === 'high',
                reducedMotion: this.reducedMotion,
            });
            clusterGlow.mesh.position.set(clusterCx, gaugeLayout.speed.y, gaugeLayout.speed.z + 0.012);
            clusterGlow.mesh.rotation.set(-0.12, 0, 0);
            this.interiorGroup.add(clusterGlow.mesh);
            glowSprites.push(clusterGlow);

            this.buildDetails();
        }

        return { instrumentClusterMat: clusterMat, centerDisplayMat: displayMat, glowSprites };
    }

    /** Flat frame with rounded corners and a chamfered edge, opening in the middle. */
    private makeBezelFrameGeometry(w: number, h: number, border: number): THREE.ExtrudeGeometry {
        const outer = this.geometryFactory.getRoundedRectShape(w, h, border);
        const inner = this.geometryFactory.getRoundedRectShape(w - border * 2, h - border * 2, border * 0.5);
        outer.holes.push(new THREE.Path(inner.getPoints(12)));
        return new THREE.ExtrudeGeometry(outer, {
            depth: 0.012,
            bevelEnabled: true,
            bevelThickness: 0.004,
            bevelSize: 0.004,
            bevelSegments: 2,
        });
    }

    /** Push-button cap with rounded corners and a chamfered face. */
    private makeButtonGeometry(w: number, h: number): THREE.ExtrudeGeometry {
        const shape = this.geometryFactory.getRoundedRectShape(w, h, Math.min(w, h) * 0.25);
        return new THREE.ExtrudeGeometry(shape, {
            depth: 0.004,
            bevelEnabled: true,
            bevelThickness: 0.0015,
            bevelSize: 0.0015,
            bevelSegments: 2,
        });
    }

    private buildDetails(): void {
        const gf = this.geometryFactory;
        const chrome = this.materials.chrome;

        // Air vents: dark recessed housing, chrome surround, horizontal slats.
        const ventHousingMat = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0c, roughness: 0.85, metalness: 0.05 });
        const ventPositions: Array<{ x: number; w: number; h: number }> = [
            { x: -0.7, w: 0.12, h: 0.08 },
            { x: 0.7, w: 0.12, h: 0.08 },
            { x: 0.55, w: 0.15, h: 0.06 },
        ];

        const slatGeo = gf.getBox(0.11, 0.006, 0.006);
        const slatMat = new THREE.MeshPhysicalMaterial({
            color: 0x1a1a1a,
            roughness: 0.5,
            metalness: 0.2,
            clearcoat: 0.4,
            clearcoatRoughness: 0.3,
        });
        this.lodManager.registerBatch('ventSlats', slatGeo, slatMat, 12);
        const slatBatch = this.lodManager.getBatch('ventSlats')!;
        this.interiorGroup.add(slatBatch);

        const dummy = new THREE.Object3D();
        for (const vent of ventPositions) {
            const housing = new THREE.Mesh(gf.getBox(vent.w, vent.h, 0.03), ventHousingMat);
            housing.position.set(vent.x, 0.95, -0.75);
            this.interiorGroup.add(housing);

            const surround = new THREE.Mesh(this.makeBezelFrameGeometry(vent.w + 0.02, vent.h + 0.02, 0.008), chrome);
            surround.position.set(vent.x, 0.95, -0.745);
            this.interiorGroup.add(surround);

            const slatCount = 4;
            for (let i = 0; i < slatCount; i++) {
                const y = 0.95 - vent.h / 2 + (vent.h / (slatCount + 1)) * (i + 1);
                dummy.position.set(vent.x, y, -0.735);
                dummy.rotation.set(-0.25, 0, 0);
                dummy.scale.set(vent.w / 0.12, 1, 1);
                dummy.updateMatrix();
                this.lodManager.addInstance('ventSlats', dummy.matrix);
            }
        }
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);

        // Climate knobs: knurled cylinders with chrome collars and position indicators.
        const knobGeo = gf.getCylinder(0.025, 0.025, 0.015, this.segments);
        const knobMat = new THREE.MeshPhysicalMaterial({
            color: 0x2e2e2e,
            roughness: 0.45,
            metalness: 0.3,
            clearcoat: 0.5,
            clearcoatRoughness: 0.2,
        });
        this.lodManager.registerBatch('knobs', knobGeo, knobMat, 3);
        const knobBatch = this.lodManager.getBatch('knobs')!;
        this.interiorGroup.add(knobBatch);

        const collarGeo = new THREE.TorusGeometry(0.026, 0.003, 8, this.segments);
        this.lodManager.registerBatch('knobCollars', collarGeo, chrome, 3);
        const collarBatch = this.lodManager.getBatch('knobCollars')!;
        this.interiorGroup.add(collarBatch);

        const indicatorGeo = gf.getBox(0.015, 0.002, 0.008);
        const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.lodManager.registerBatch('indicators', indicatorGeo, indicatorMat, 3);
        const indicatorBatch = this.lodManager.getBatch('indicators')!;
        this.interiorGroup.add(indicatorBatch);

        for (let i = 0; i < 3; i++) {
            dummy.position.set(0.45 + i * 0.06, 0.85, -0.72);
            dummy.updateMatrix();
            this.lodManager.addInstance('knobs', dummy.matrix);
            this.lodManager.addInstance('knobCollars', dummy.matrix);

            dummy.position.set(0.45 + i * 0.06, 0.85, -0.715);
            dummy.updateMatrix();
            this.lodManager.addInstance('indicators', dummy.matrix);
        }
        this.lodManager.finalize();

        const hazardGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.008, this.segments);
        const hazardMat = new THREE.MeshPhysicalMaterial({
            color: 0xff0000,
            emissive: 0x330000,
            emissiveIntensity: 0.3,
            roughness: 0.3,
            clearcoat: 0.6,
            clearcoatRoughness: 0.15,
        });
        registerGlowMaterial(hazardMat, 0.3);
        const hazardBtn = new THREE.Mesh(hazardGeo, hazardMat);
        hazardBtn.name = 'hazardBtn';
        hazardBtn.position.set(0.35, 0.85, -0.72);
        this.interiorGroup.add(hazardBtn);

        const hazardSymbolGeo = new THREE.ConeGeometry(0.008, 0.012, 3);
        const hazardSymbolMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const hazardSymbol = new THREE.Mesh(hazardSymbolGeo, hazardSymbolMat);
        hazardSymbol.rotation.x = Math.PI;
        hazardSymbol.position.set(0.35, 0.85, -0.715);
        this.interiorGroup.add(hazardSymbol);

        // Center-stack button bank: extruded caps with depth and chamfers.
        const btnGeo = this.makeButtonGeometry(0.03, 0.015);
        const btnMat = new THREE.MeshPhysicalMaterial({
            color: 0x3a3a3a,
            roughness: 0.55,
            metalness: 0.1,
            clearcoat: 0.35,
            clearcoatRoughness: 0.4,
            emissive: 0xffb060,
            emissiveIntensity: 0.12,
        });
        registerGlowMaterial(btnMat, 0.12);

        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 4; col++) {
                const btn = new THREE.Mesh(btnGeo, btnMat);
                btn.position.set(0.05 + col * 0.035, 0.82 - row * 0.02, -0.722);
                this.interiorGroup.add(btn);
                this.lodManager.registerDetail(btn);
            }
        }

        const startBtnGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.01, this.segments);
        const startBtnMat = new THREE.MeshPhysicalMaterial({
            color: 0xcc0000,
            emissive: 0x220000,
            emissiveIntensity: 0.2,
            roughness: 0.3,
            metalness: 0.4,
            clearcoat: 0.8,
            clearcoatRoughness: 0.1,
        });
        registerGlowMaterial(startBtnMat, 0.2);
        const startBtn = new THREE.Mesh(startBtnGeo, startBtnMat);
        startBtn.position.set(0.0, 0.82, -0.72);
        this.interiorGroup.add(startBtn);

        const startRingGeo = new THREE.TorusGeometry(0.02, 0.003, 12, this.segments);
        const startRing = new THREE.Mesh(startRingGeo, chrome);
        startRing.position.set(0.0, 0.82, -0.715);
        this.interiorGroup.add(startRing);
    }
}
