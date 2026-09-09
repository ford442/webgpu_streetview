import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { GeometryFactory } from './GeometryFactory';
import { CarInteriorMaterials } from './CarInteriorBuilder';

export class CarInteriorSeatBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private materials: CarInteriorMaterials,
        private vehicleConfig: VehicleConfig,
        private quality: 'high' | 'medium' | 'low',
        private geometryFactory: GeometryFactory
    ) {}

    public build(): void {
        this.buildSeats();
    }

    private buildSeats(): void {
        const gf = this.geometryFactory;
        const seatBackGeo = gf.getBox(0.5, 0.7, 0.12);
        const seatBottomGeo = gf.getBox(0.5, 0.1, 0.5);
        const headrestGeo = gf.getBox(0.2, 0.2, 0.08);

        const seatBack = new THREE.Mesh(seatBackGeo, this.materials.leather);
        seatBack.position.set(-0.35, 0.9, 0.5);
        seatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(seatBack);

        const seatBottom = new THREE.Mesh(seatBottomGeo, this.materials.leather);
        seatBottom.position.set(-0.35, 0.5, 0.2);
        this.interiorGroup.add(seatBottom);

        const passSeatBack = new THREE.Mesh(seatBackGeo, this.materials.leather);
        passSeatBack.position.set(0.45, 0.9, 0.5);
        passSeatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(passSeatBack);

        const passSeatBottom = new THREE.Mesh(seatBottomGeo, this.materials.leather);
        passSeatBottom.position.set(0.45, 0.5, 0.2);
        this.interiorGroup.add(passSeatBottom);

        const headrest = new THREE.Mesh(headrestGeo, this.materials.leather);
        headrest.position.set(-0.35, 1.35, 0.5);
        this.interiorGroup.add(headrest);

        const headrestPass = new THREE.Mesh(headrestGeo, this.materials.leather);
        headrestPass.position.set(0.45, 1.35, 0.5);
        this.interiorGroup.add(headrestPass);

        if (this.vehicleConfig.type === 'cortianics') {
            this.buildCortianicsHeadrestCrests();
        }

        const stalkGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6);
        for (const x of [-0.35, 0.45]) {
            for (const offset of [-0.05, 0.05]) {
                const stalk = new THREE.Mesh(stalkGeo, this.materials.metal);
                stalk.position.set(x + offset, 1.22, 0.52);
                this.interiorGroup.add(stalk);
            }
        }

        const anchorGeo = new THREE.BoxGeometry(0.035, 0.05, 0.015);
        const anchorMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.35,
            metalness: 0.85,
        });
        const driverAnchor = new THREE.Mesh(anchorGeo, anchorMat);
        driverAnchor.position.set(-0.6, 1.25, 0.45);
        this.interiorGroup.add(driverAnchor);

        const passAnchor = new THREE.Mesh(anchorGeo, anchorMat);
        passAnchor.position.set(0.7, 1.25, 0.45);
        this.interiorGroup.add(passAnchor);

        if (this.quality !== 'low') {
            this.buildSeatDetails();
        }
    }

    private buildSeatDetails(): void {
        const stitchMaterial = new THREE.MeshStandardMaterial({
            color: this.vehicleConfig.type === 'cortianics' ? 0xc9a227 : 0x9B5523,
            roughness: 0.58,
            metalness: this.vehicleConfig.type === 'cortianics' ? 0.35 : 0.0,
            envMapIntensity: 0.3,
        });

        const driverCenterGeo = new THREE.PlaneGeometry(0.22, 0.45, 5, 9);
        const pos = driverCenterGeo.attributes.position;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const diamond = (Math.floor((x + 0.11) / 0.044) + Math.floor((y + 0.225) / 0.05)) % 2 === 0;
            if (diamond) {
                pos.setZ(i, 0.008);
            }
        }
        driverCenterGeo.computeVertexNormals();

        const driverCenter = new THREE.Mesh(driverCenterGeo, stitchMaterial);
        driverCenter.position.set(-0.35, 0.9, 0.565);
        driverCenter.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(driverCenter);

        const driverBottomCenterGeo = new THREE.PlaneGeometry(0.22, 0.35, 5, 7);
        const posB = driverBottomCenterGeo.attributes.position;
        if (!posB) return;
        for (let i = 0; i < posB.count; i++) {
            const x = posB.getX(i);
            const y = posB.getY(i);
            const diamond = (Math.floor((x + 0.11) / 0.044) + Math.floor((y + 0.175) / 0.05)) % 2 === 0;
            if (diamond) {
                posB.setZ(i, 0.008);
            }
        }
        driverBottomCenterGeo.computeVertexNormals();

        const driverBottomCenter = new THREE.Mesh(driverBottomCenterGeo, stitchMaterial);
        driverBottomCenter.position.set(-0.35, 0.56, 0.23);
        driverBottomCenter.rotation.x = -Math.PI / 2;
        this.interiorGroup.add(driverBottomCenter);

        const passCenterGeo = new THREE.PlaneGeometry(0.22, 0.45, 5, 9);
        const posP = passCenterGeo.attributes.position;
        if (!posP) return;
        for (let i = 0; i < posP.count; i++) {
            const x = posP.getX(i);
            const y = posP.getY(i);
            const diamond = (Math.floor((x + 0.11) / 0.044) + Math.floor((y + 0.225) / 0.05)) % 2 === 0;
            if (diamond) {
                posP.setZ(i, 0.008);
            }
        }
        passCenterGeo.computeVertexNormals();

        const passCenter = new THREE.Mesh(passCenterGeo, stitchMaterial);
        passCenter.position.set(0.45, 0.9, 0.565);
        passCenter.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(passCenter);

        const passBottomCenterGeo = new THREE.PlaneGeometry(0.22, 0.35, 5, 7);
        const posPB = passBottomCenterGeo.attributes.position;
        if (!posPB) return;
        for (let i = 0; i < posPB.count; i++) {
            const x = posPB.getX(i);
            const y = posPB.getY(i);
            const diamond = (Math.floor((x + 0.11) / 0.044) + Math.floor((y + 0.175) / 0.05)) % 2 === 0;
            if (diamond) {
                posPB.setZ(i, 0.008);
            }
        }
        passBottomCenterGeo.computeVertexNormals();

        const passBottomCenter = new THREE.Mesh(passBottomCenterGeo, stitchMaterial);
        passBottomCenter.position.set(0.45, 0.56, 0.23);
        passBottomCenter.rotation.x = -Math.PI / 2;
        this.interiorGroup.add(passBottomCenter);

        const bolsterMaterial = new THREE.MeshStandardMaterial({
            color: 0x7B4010,
            roughness: 0.70,
            metalness: 0.0,
            envMapIntensity: 0.25,
        });

        const leftBolsterGeo = new THREE.BoxGeometry(0.08, 0.5, 0.08);
        const leftBolster = new THREE.Mesh(leftBolsterGeo, bolsterMaterial);
        leftBolster.position.set(-0.58, 0.9, 0.52);
        leftBolster.rotation.set(-0.15, 0.1, 0);
        this.interiorGroup.add(leftBolster);

        const rightBolsterGeo = new THREE.BoxGeometry(0.08, 0.5, 0.08);
        const rightBolster = new THREE.Mesh(rightBolsterGeo, bolsterMaterial);
        rightBolster.position.set(-0.12, 0.9, 0.52);
        rightBolster.rotation.set(-0.15, -0.1, 0);
        this.interiorGroup.add(rightBolster);

        const leftBolsterP = new THREE.Mesh(leftBolsterGeo, bolsterMaterial);
        leftBolsterP.position.set(0.22, 0.9, 0.52);
        leftBolsterP.rotation.set(-0.15, 0.1, 0);
        this.interiorGroup.add(leftBolsterP);

        const rightBolsterP = new THREE.Mesh(rightBolsterGeo, bolsterMaterial);
        rightBolsterP.position.set(0.68, 0.9, 0.52);
        rightBolsterP.rotation.set(-0.15, -0.1, 0);
        this.interiorGroup.add(rightBolsterP);
    }

    private buildCortianicsHeadrestCrests(): void {
        const crestFillMaterial = new THREE.MeshStandardMaterial({
            color: 0xc9a227,
            roughness: 0.35,
            metalness: 0.35,
            side: THREE.DoubleSide,
        });
        const crestRingMaterial = new THREE.MeshStandardMaterial({
            color: 0x896916,
            roughness: 0.28,
            metalness: 0.5,
            side: THREE.DoubleSide,
        });

        for (const x of [-0.35, 0.45]) {
            const crestFill = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), crestFillMaterial);
            crestFill.name = 'CortianicsCrest';
            crestFill.position.set(x, 1.36, 0.545);
            this.interiorGroup.add(crestFill);

            const crestRing = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.034, 24), crestRingMaterial);
            crestRing.name = 'CortianicsCrest';
            crestRing.position.set(x, 1.36, 0.546);
            this.interiorGroup.add(crestRing);
        }
    }
}
