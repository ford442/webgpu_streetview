import * as THREE from 'three';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import type { CarInteriorMaterials } from './CarInteriorBuilder';

/**
 * Door cards, armrests, and the center console.
 *
 * Everything past the bare panels is detail work gated on `quality !== 'low'`:
 * speaker grilles, handles and recesses, window-switch panels, and the
 * soft-touch inserts. The switch buttons go through `LODManager` as one
 * instanced batch rather than eight meshes.
 */
export class CarInteriorDoorBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private materials: CarInteriorMaterials,
        private quality: 'high' | 'medium' | 'low',
        private geometryFactory: GeometryFactory,
        private lodManager: LODManager,
    ) {}

    public build(): void {
        const leftDoorGeo = new THREE.BoxGeometry(0.08, 0.6, 1.8);
        const leftDoor = new THREE.Mesh(leftDoorGeo, this.materials.frame);
        leftDoor.position.set(-1.0, 0.7, 0.0);
        this.interiorGroup.add(leftDoor);

        const leftArmGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const leftArm = new THREE.Mesh(leftArmGeo, this.materials.leather);
        leftArm.position.set(-0.96, 0.85, 0.1);
        this.interiorGroup.add(leftArm);

        const rightDoorGeo = new THREE.BoxGeometry(0.08, 0.6, 1.8);
        const rightDoor = new THREE.Mesh(rightDoorGeo, this.materials.frame);
        rightDoor.position.set(1.0, 0.7, 0.0);
        this.interiorGroup.add(rightDoor);

        const rightArmGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const rightArm = new THREE.Mesh(rightArmGeo, this.materials.leather);
        rightArm.position.set(0.96, 0.85, 0.1);
        this.interiorGroup.add(rightArm);

        const consoleGeo = new THREE.BoxGeometry(0.3, 0.35, 0.8);
        const consoleMesh = new THREE.Mesh(consoleGeo, this.materials.dashboard);
        consoleMesh.position.set(0.0, 0.55, 0.3);
        this.interiorGroup.add(consoleMesh);

        if (this.quality !== 'low') {
            this.buildDoorPanelDetails();
        }
    }

    private buildDoorPanelDetails(): void {
        const gf = this.geometryFactory;
        const chromeMaterial = this.materials.chrome;

        const softTouchMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.7,
            metalness: 0.0,
        });

        const grilleMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.9,
        });

        const speakerGeo = gf.getCircle(0.08, 32);
        const leftSpeaker = new THREE.Mesh(speakerGeo, grilleMat);
        leftSpeaker.position.set(-0.96, 0.55, 0.6);
        leftSpeaker.rotation.y = Math.PI / 2;
        this.interiorGroup.add(leftSpeaker);

        for (let i = 1; i <= 3; i++) {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.015 * i, 0.015 * i + 0.005, 32),
                new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
            );
            ring.position.set(-0.955, 0.55, 0.6);
            ring.rotation.y = Math.PI / 2;
            this.interiorGroup.add(ring);
            this.lodManager.registerDetail(ring as THREE.Mesh);
        }

        const rightSpeaker = new THREE.Mesh(speakerGeo, grilleMat);
        rightSpeaker.position.set(0.96, 0.55, 0.6);
        rightSpeaker.rotation.y = -Math.PI / 2;
        this.interiorGroup.add(rightSpeaker);

        for (let i = 1; i <= 3; i++) {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.015 * i, 0.015 * i + 0.005, 32),
                new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
            );
            ring.position.set(0.955, 0.55, 0.6);
            ring.rotation.y = -Math.PI / 2;
            this.interiorGroup.add(ring);
            this.lodManager.registerDetail(ring as THREE.Mesh);
        }

        const handleGeo = gf.getBox(0.04, 0.015, 0.08);
        const leftHandle = new THREE.Mesh(handleGeo, chromeMaterial);
        leftHandle.position.set(-0.96, 0.92, -0.4);
        this.interiorGroup.add(leftHandle);

        const handleRecessGeo = gf.getBox(0.03, 0.04, 0.1);
        const leftHandleRecess = new THREE.Mesh(handleRecessGeo, softTouchMat);
        leftHandleRecess.position.set(-0.96, 0.9, -0.4);
        this.interiorGroup.add(leftHandleRecess);

        const rightHandle = new THREE.Mesh(handleGeo, chromeMaterial);
        rightHandle.position.set(0.96, 0.92, -0.4);
        this.interiorGroup.add(rightHandle);

        const rightHandleRecess = new THREE.Mesh(handleRecessGeo, softTouchMat);
        rightHandleRecess.position.set(0.96, 0.9, -0.4);
        this.interiorGroup.add(rightHandleRecess);

        const switchPanelGeo = gf.getBox(0.03, 0.08, 0.15);
        const switchPanelMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const leftSwitchPanel = new THREE.Mesh(switchPanelGeo, switchPanelMat);
        leftSwitchPanel.position.set(-0.96, 0.85, -0.2);
        this.interiorGroup.add(leftSwitchPanel);

        const switchBtnGeo = gf.getBox(0.008, 0.015, 0.02);
        const switchBtnMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
        this.lodManager.registerBatch('windowSwitches', switchBtnGeo, switchBtnMat, 8);
        const switchBatch = this.lodManager.getBatch('windowSwitches')!;
        this.interiorGroup.add(switchBatch);

        const dummy = new THREE.Object3D();
        for (let i = 0; i < 4; i++) {
            dummy.position.set(-0.945, 0.87 - i * 0.018, -0.2);
            dummy.updateMatrix();
            this.lodManager.addInstance('windowSwitches', dummy.matrix);
        }

        const rightSwitchPanel = new THREE.Mesh(switchPanelGeo, switchPanelMat);
        rightSwitchPanel.position.set(0.96, 0.85, -0.2);
        this.interiorGroup.add(rightSwitchPanel);

        dummy.position.set(0.945, 0.87, -0.2);
        dummy.updateMatrix();
        this.lodManager.addInstance('windowSwitches', dummy.matrix);
        this.lodManager.finalize();

        const insertGeo = new THREE.BoxGeometry(0.04, 0.25, 0.6);
        const leftInsert = new THREE.Mesh(insertGeo, softTouchMat);
        leftInsert.position.set(-0.96, 0.95, 0.2);
        this.interiorGroup.add(leftInsert);

        const rightInsert = new THREE.Mesh(insertGeo, softTouchMat);
        rightInsert.position.set(0.96, 0.95, 0.2);
        this.interiorGroup.add(rightInsert);
    }
}
