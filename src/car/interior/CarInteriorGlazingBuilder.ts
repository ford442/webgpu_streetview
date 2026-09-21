import * as THREE from 'three';
import { createGlassMaterial } from '../../materials/PBRMaterials';
import type { CarInteriorMaterials } from './CarInteriorBuilder';

export interface CarInteriorGlazingResult {
    windshieldGlassMesh: THREE.Mesh;
    rearGlassMesh: THREE.Mesh;
}

export interface CarInteriorWiperResult {
    wiperLeft: THREE.Group;
    wiperRight: THREE.Group;
}

/**
 * Windshield, rear window, their frames, and the wiper arms.
 *
 * The windshield plane is displaced per-vertex into a barrel curve plus a rake
 * so reflections and the rain overlay bend the way a real screen does — keep
 * that displacement if you resize it, a flat plane reads as a decal.
 *
 * Wiper groups are returned as empty pivots; `CarInteriorAnimator` owns their
 * sweep, and `InteriorMicroInteractions` owns the stalk that toggles them.
 */
export class CarInteriorGlazingBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private materials: CarInteriorMaterials,
        private quality: 'high' | 'medium' | 'low',
    ) {}

    /** Windshield frame + glass and the rear window. */
    public build(): CarInteriorGlazingResult {
        this.buildWindshieldFrame();
        const windshieldGlassMesh = this.buildWindshieldGlass();
        const rearGlassMesh = this.buildRearWindow();
        return { windshieldGlassMesh, rearGlassMesh };
    }

    private buildWindshieldFrame(): void {
        const pillarGeo = new THREE.BoxGeometry(0.06, 0.8, 0.06);

        const leftPillar = new THREE.Mesh(pillarGeo, this.materials.frame);
        leftPillar.position.set(-0.95, 1.3, -0.85);
        leftPillar.rotation.set(-0.2, 0, -0.1);
        this.interiorGroup.add(leftPillar);

        const rightPillar = new THREE.Mesh(pillarGeo, this.materials.frame);
        rightPillar.position.set(0.95, 1.3, -0.85);
        rightPillar.rotation.set(-0.2, 0, 0.1);
        this.interiorGroup.add(rightPillar);

        const topBarGeo = new THREE.BoxGeometry(1.95, 0.06, 0.06);
        const topBar = new THREE.Mesh(topBarGeo, this.materials.frame);
        topBar.position.set(0, 1.6, -0.9);
        this.interiorGroup.add(topBar);

        if (this.quality !== 'low') {
            const rubberMat = new THREE.MeshStandardMaterial({
                color: 0x0a0a0a,
                roughness: 0.98,
                metalness: 0.0,
            });
            const sealGeo = new THREE.BoxGeometry(0.016, 0.78, 0.016);

            const leftSeal = new THREE.Mesh(sealGeo, rubberMat);
            leftSeal.position.set(-0.922, 1.3, -0.87);
            leftSeal.rotation.set(-0.2, 0, -0.1);
            this.interiorGroup.add(leftSeal);

            const rightSeal = new THREE.Mesh(sealGeo, rubberMat);
            rightSeal.position.set(0.922, 1.3, -0.87);
            rightSeal.rotation.set(-0.2, 0, 0.1);
            this.interiorGroup.add(rightSeal);

            const topSealGeo = new THREE.BoxGeometry(1.93, 0.016, 0.016);
            const topSeal = new THREE.Mesh(topSealGeo, rubberMat);
            topSeal.position.set(0, 1.63, -0.91);
            this.interiorGroup.add(topSeal);

            const bottomSealGeo = new THREE.BoxGeometry(1.93, 0.016, 0.016);
            const bottomSeal = new THREE.Mesh(bottomSealGeo, rubberMat);
            bottomSeal.position.set(0, 0.96, -0.86);
            this.interiorGroup.add(bottomSeal);
        }

        const mirrorMountGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 6);
        const mirrorMount = new THREE.Mesh(mirrorMountGeo, this.materials.metal);
        mirrorMount.position.set(0, 1.5, -0.85);
        this.interiorGroup.add(mirrorMount);
    }

    private buildWindshieldGlass(): THREE.Mesh {
        const geometry = new THREE.PlaneGeometry(1.9, 0.75, 16, 8);
        const pos = geometry.attributes.position!;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const zOffset = -(x * x) * 0.15;
            const rake = (y - 0.375) * 0.12;
            pos.setZ(i, zOffset + rake);
        }
        geometry.computeVertexNormals();

        const glassMat = createGlassMaterial('#eef5f8', 0.1);
        const windshieldGlassMesh = new THREE.Mesh(geometry, glassMat);
        windshieldGlassMesh.name = 'Windshield';
        windshieldGlassMesh.position.set(0, 1.3, -0.88);
        windshieldGlassMesh.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(windshieldGlassMesh);
        return windshieldGlassMesh;
    }

    private buildRearWindow(): THREE.Mesh {
        const rearTopBarGeo = new THREE.BoxGeometry(1.9, 0.05, 0.05);
        const rearTopBar = new THREE.Mesh(rearTopBarGeo, this.materials.frame);
        rearTopBar.position.set(0, 1.58, 0.6);
        this.interiorGroup.add(rearTopBar);

        const cPillarGeo = new THREE.BoxGeometry(0.06, 0.5, 0.05);

        const leftCPillar = new THREE.Mesh(cPillarGeo, this.materials.frame);
        leftCPillar.position.set(-0.92, 1.33, 0.6);
        leftCPillar.rotation.z = -0.12;
        this.interiorGroup.add(leftCPillar);

        const rightCPillar = new THREE.Mesh(cPillarGeo, this.materials.frame);
        rightCPillar.position.set(0.92, 1.33, 0.6);
        rightCPillar.rotation.z = 0.12;
        this.interiorGroup.add(rightCPillar);

        const rearBottomBarGeo = new THREE.BoxGeometry(1.85, 0.04, 0.04);
        const rearBottomBar = new THREE.Mesh(rearBottomBarGeo, this.materials.frame);
        rearBottomBar.position.set(0, 1.1, 0.62);
        this.interiorGroup.add(rearBottomBar);

        const rearGlassGeo = new THREE.PlaneGeometry(1.8, 0.48);
        const rearGlassMat = createGlassMaterial('#6a9aae', 0.15);
        const rearGlassMesh = new THREE.Mesh(rearGlassGeo, rearGlassMat);
        rearGlassMesh.name = 'rearGlass';
        rearGlassMesh.position.set(0, 1.34, 0.64);
        this.interiorGroup.add(rearGlassMesh);

        for (let i = 0; i < 4; i++) {
            const defrosterGeo = new THREE.BoxGeometry(1.7, 0.002, 0.001);
            const defroster = new THREE.Mesh(defrosterGeo, new THREE.MeshBasicMaterial({
                color: 0x333333,
                transparent: true,
                opacity: 0.3,
            }));
            defroster.position.set(0, 1.2 + i * 0.08, 0.641);
            this.interiorGroup.add(defroster);
        }

        const parcelShelfGeo = new THREE.BoxGeometry(1.8, 0.05, 0.5);
        const parcelShelfMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.9,
        });
        const parcelShelf = new THREE.Mesh(parcelShelfGeo, parcelShelfMat);
        parcelShelf.position.set(0, 1.08, 0.4);
        this.interiorGroup.add(parcelShelf);

        return rearGlassMesh;
    }

    /**
     * Wiper pivots. Separate from `build()` so the orchestrator can keep the
     * historical add order (glass -> mirrors -> wipers) and so vehicles without
     * wipers simply never call it.
     */
    public buildWipers(): CarInteriorWiperResult {
        const wiperLeft = new THREE.Group();
        wiperLeft.name = 'WiperL';
        wiperLeft.position.set(-0.2, 1.1, -0.9);
        this.interiorGroup.add(wiperLeft);

        const leftWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const leftWiperBlad = new THREE.Mesh(leftWiperBladGeo, this.materials.metal);
        leftWiperBlad.position.set(0, 0.15, 0);
        leftWiperBlad.rotation.set(0, 0, -Math.PI / 6);
        wiperLeft.add(leftWiperBlad);

        const wiperRight = new THREE.Group();
        wiperRight.name = 'WiperR';
        wiperRight.position.set(0.2, 1.1, -0.9);
        this.interiorGroup.add(wiperRight);

        const rightWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const rightWiperBlad = new THREE.Mesh(rightWiperBladGeo, this.materials.metal);
        rightWiperBlad.position.set(0, 0.15, 0);
        rightWiperBlad.rotation.set(0, 0, Math.PI / 6);
        wiperRight.add(rightWiperBlad);

        return { wiperLeft, wiperRight };
    }
}
