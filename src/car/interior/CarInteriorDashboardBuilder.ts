import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import type { CarInteriorMaterials } from './CarInteriorBuilder';

export class CarInteriorDashboardBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private materials: CarInteriorMaterials,
        private vehicleConfig: VehicleConfig,
        private quality: 'high' | 'medium' | 'low',
        private geometryFactory: GeometryFactory,
        private lodManager: LODManager
    ) {}

    public build(): { instrumentClusterMat: THREE.MeshStandardMaterial; centerDisplayMat: THREE.MeshStandardMaterial } {
        const dashGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
        const dash = new THREE.Mesh(dashGeo, this.materials.dashboard);
        dash.position.set(0, 0.8, -1.0);
        this.interiorGroup.add(dash);

        const dashTopGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 8, 1, false, 0, Math.PI);
        const dashTop = new THREE.Mesh(dashTopGeo, this.materials.dashboard);
        dashTop.rotation.set(0, 0, Math.PI / 2);
        dashTop.position.set(0, 1.0, -0.85);
        this.interiorGroup.add(dashTop);

        const clusterGeo = new THREE.BoxGeometry(0.6, 0.25, 0.05);
        const clusterMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x001100, emissiveIntensity: 0.5 });
        const cluster = new THREE.Mesh(clusterGeo, clusterMat);
        cluster.position.set(-0.3, 0.95, -0.74);
        this.interiorGroup.add(cluster);

        const displayGeo = new THREE.BoxGeometry(0.3, 0.2, 0.02);
        const displayMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x002200, emissiveIntensity: 0.3 });
        const display = new THREE.Mesh(displayGeo, displayMat);
        display.position.set(0.15, 0.95, -0.74);
        this.interiorGroup.add(display);

        if (this.quality !== 'low') {
            const accentHex = parseInt(this.vehicleConfig.accentColor.replace('#', '0x'));
            const trimGeo = new THREE.BoxGeometry(1.96, 0.008, 0.012);
            const trimMat = new THREE.MeshStandardMaterial({
                color: accentHex,
                roughness: 0.3,
                metalness: 0.7,
                emissive: new THREE.Color(accentHex),
                emissiveIntensity: 0.15,
            });
            const trim = new THREE.Mesh(trimGeo, trimMat);
            trim.position.set(0, 1.005, -0.86);
            this.interiorGroup.add(trim);

            const lowerTrimGeo = new THREE.BoxGeometry(1.96, 0.006, 0.01);
            const lowerTrim = new THREE.Mesh(lowerTrimGeo, trimMat);
            lowerTrim.position.set(0, 0.625, -0.99);
            this.interiorGroup.add(lowerTrim);

            const bezelRingGeo = new THREE.TorusGeometry(0.155, 0.008, 8, 32);
            const bezelRingMat = new THREE.MeshStandardMaterial({
                color: accentHex,
                roughness: 0.2,
                metalness: 0.8,
                emissive: new THREE.Color(accentHex),
                emissiveIntensity: 0.4,
            });
            const bezelRing = new THREE.Mesh(bezelRingGeo, bezelRingMat);
            bezelRing.position.set(-0.3, 0.95, -0.73);
            this.interiorGroup.add(bezelRing);
        }

        if (this.quality !== 'low') {
            this.buildDetails();
        }

        return { instrumentClusterMat: clusterMat, centerDisplayMat: displayMat };
    }

    private buildDetails(): void {
        const gf = this.geometryFactory;

        const chromeMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.15,
            metalness: 0.9,
        });

        const ventGeo = gf.getBox(0.12, 0.08, 0.03);
        const ventMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

        const leftVent = new THREE.Mesh(ventGeo, ventMat);
        leftVent.position.set(-0.7, 0.95, -0.74);
        this.interiorGroup.add(leftVent);

        const ventSurroundGeo = gf.getBox(0.14, 0.1, 0.02);
        const leftVentSurround = new THREE.Mesh(ventSurroundGeo, chromeMaterial);
        leftVentSurround.position.set(-0.7, 0.95, -0.735);
        this.interiorGroup.add(leftVentSurround);

        const rightVent = new THREE.Mesh(ventGeo, ventMat);
        rightVent.position.set(0.7, 0.95, -0.74);
        this.interiorGroup.add(rightVent);

        const rightVentSurround = new THREE.Mesh(ventSurroundGeo, chromeMaterial);
        rightVentSurround.position.set(0.7, 0.95, -0.735);
        this.interiorGroup.add(rightVentSurround);

        const centerVent = new THREE.Mesh(gf.getBox(0.15, 0.06, 0.03), ventMat);
        centerVent.position.set(0.55, 0.95, -0.74);
        this.interiorGroup.add(centerVent);

        const knobGeo = gf.getCylinder(0.025, 0.025, 0.015, 16);
        const knobMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.4,
            metalness: 0.3,
        });
        this.lodManager.registerBatch('knobs', knobGeo, knobMat, 3);
        const knobBatch = this.lodManager.getBatch('knobs')!;
        this.interiorGroup.add(knobBatch);

        const indicatorGeo = gf.getBox(0.015, 0.002, 0.008);
        const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.lodManager.registerBatch('indicators', indicatorGeo, indicatorMat, 3);
        const indicatorBatch = this.lodManager.getBatch('indicators')!;
        this.interiorGroup.add(indicatorBatch);

        const dummy = new THREE.Object3D();
        for (let i = 0; i < 3; i++) {
            dummy.position.set(0.45 + i * 0.06, 0.85, -0.72);
            dummy.updateMatrix();
            this.lodManager.addInstance('knobs', dummy.matrix);

            dummy.position.set(0.45 + i * 0.06, 0.85, -0.715);
            dummy.updateMatrix();
            this.lodManager.addInstance('indicators', dummy.matrix);
        }
        this.lodManager.finalize();

        const hazardGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.008, 16);
        const hazardMat = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0x330000,
            emissiveIntensity: 0.3,
            roughness: 0.3,
        });
        const hazardBtn = new THREE.Mesh(hazardGeo, hazardMat);
        hazardBtn.position.set(0.35, 0.85, -0.72);
        this.interiorGroup.add(hazardBtn);

        const hazardSymbolGeo = new THREE.ConeGeometry(0.008, 0.012, 3);
        const hazardSymbolMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const hazardSymbol = new THREE.Mesh(hazardSymbolGeo, hazardSymbolMat);
        hazardSymbol.rotation.x = Math.PI;
        hazardSymbol.position.set(0.35, 0.85, -0.715);
        this.interiorGroup.add(hazardSymbol);

        const btnGeo = new THREE.BoxGeometry(0.03, 0.015, 0.005);
        const btnMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 });

        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 4; col++) {
                const btn = new THREE.Mesh(btnGeo, btnMat);
                btn.position.set(0.05 + col * 0.035, 0.82 - row * 0.02, -0.72);
                this.interiorGroup.add(btn);
            }
        }

        const startBtnGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.01, 16);
        const startBtnMat = new THREE.MeshStandardMaterial({
            color: 0xcc0000,
            emissive: 0x220000,
            emissiveIntensity: 0.2,
            roughness: 0.3,
            metalness: 0.4,
        });
        const startBtn = new THREE.Mesh(startBtnGeo, startBtnMat);
        startBtn.position.set(-0.15, 0.88, -0.72);
        this.interiorGroup.add(startBtn);

        const startRingGeo = new THREE.TorusGeometry(0.02, 0.003, 8, 24);
        const startRing = new THREE.Mesh(startRingGeo, chromeMaterial);
        startRing.position.set(-0.15, 0.88, -0.715);
        this.interiorGroup.add(startRing);
    }
}
