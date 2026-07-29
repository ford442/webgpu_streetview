import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { resolveSteeringWheel } from '../vehicleLayout';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import { CarInteriorDashboardBuilder } from './CarInteriorDashboardBuilder';
import { CarInteriorSeatBuilder } from './CarInteriorSeatBuilder';
import { createGlassMaterial } from '../../materials/PBRMaterials';

export interface CarInteriorMaterials {
    dashboard: THREE.MeshStandardMaterial;
    leather: THREE.MeshStandardMaterial;
    metal: THREE.MeshStandardMaterial;
    frame: THREE.MeshStandardMaterial;
    glass: THREE.MeshStandardMaterial;
    mirror: THREE.MeshStandardMaterial;
    accent: THREE.MeshStandardMaterial;
    chrome: THREE.MeshPhysicalMaterial;
}

export interface CarInteriorBuildResult {
    steeringWheelGroup: THREE.Group;
    wiperLeft: THREE.Group;
    wiperRight: THREE.Group;
    leftMirrorPlane: THREE.Mesh;
    rightMirrorPlane: THREE.Mesh;
    windshieldGlassMesh: THREE.Mesh;
    rearGlassMesh: THREE.Mesh;
    instrumentClusterMat: THREE.MeshStandardMaterial;
    centerDisplayMat: THREE.MeshStandardMaterial;
    domeLightFixtureMesh: THREE.Mesh;
    domeSwitchMesh: THREE.Mesh;
    /** Wiper stalk lever (absent on vehicles without a steering wheel). */
    wiperStalkMesh?: THREE.Mesh;
    wiperStalkPivot?: THREE.Group;
}

export class CarInteriorBuilder {
    private result: Partial<CarInteriorBuildResult> = {};

    constructor(
        private interiorGroup: THREE.Group,
        private roofGroup: THREE.Group,
        private vehicleConfig: VehicleConfig,
        private quality: 'high' | 'medium' | 'low',
        private geometryFactory: GeometryFactory,
        private lodManager: LODManager,
        private materials: CarInteriorMaterials
    ) {}

    public buildAll(): CarInteriorBuildResult {
        if (this.vehicleConfig.hasDashboard) {
            const dashboardBuilder = new CarInteriorDashboardBuilder(
                this.interiorGroup,
                this.materials,
                this.vehicleConfig,
                this.quality,
                this.geometryFactory,
                this.lodManager
            );
            const { instrumentClusterMat, centerDisplayMat } = dashboardBuilder.build();
            this.result.instrumentClusterMat = instrumentClusterMat;
            this.result.centerDisplayMat = centerDisplayMat;
        }
        if (this.vehicleConfig.hasSteeringWheel) this.buildSteeringWheel();
        this.buildDoorPanels();
        const seatBuilder = new CarInteriorSeatBuilder(
            this.interiorGroup,
            this.materials,
            this.vehicleConfig,
            this.quality,
            this.geometryFactory
        );
        seatBuilder.build();
        this.buildFloor();
        this.buildFloorMats();
        if (this.vehicleConfig.hasRoof) this.buildRoof();
        this.buildWindshieldFrame();
        this.buildWindshieldGlass();
        this.buildRearWindow();
        if (this.vehicleConfig.hasSideMirrors) this.buildSideMirrors();
        if (this.vehicleConfig.hasWipers) this.buildWipers();
        this.buildVehicleSpecificFeatures();
        this.buildDomeLightFixture();

        return this.result as CarInteriorBuildResult;
    }

    private buildSteeringWheel(): void {
        const wheelCfg = resolveSteeringWheel(this.vehicleConfig);
        this.result.steeringWheelGroup = new THREE.Group();
        this.result.steeringWheelGroup.position.set(
            wheelCfg.position.x,
            wheelCfg.position.y,
            wheelCfg.position.z,
        );
        this.interiorGroup.add(this.result.steeringWheelGroup);

        const wheelRimMat = new THREE.MeshStandardMaterial({
            color: 0x0e0a06,
            roughness: 0.62,
            metalness: 0.04,
            envMapIntensity: 0.3,
            side: THREE.DoubleSide,
        });

        const wheelGeo = new THREE.TorusGeometry(wheelCfg.rimRadius, wheelCfg.rimRadius * 0.12, 12, 32);
        const wheel = new THREE.Mesh(wheelGeo, wheelRimMat);
        wheel.rotation.set(wheelCfg.tilt, 0, 0);
        this.result.steeringWheelGroup.add(wheel);

        const hubGeo = new THREE.CylinderGeometry(wheelCfg.rimRadius * 0.33, wheelCfg.rimRadius * 0.33, 0.02, 16);
        const hub = new THREE.Mesh(hubGeo, this.materials.dashboard);
        hub.rotation.set(wheelCfg.tilt, 0, 0);
        this.result.steeringWheelGroup.add(hub);

        for (let i = 0; i < 3; i++) {
            const spokeGeo = new THREE.BoxGeometry(0.015, wheelCfg.rimRadius * 0.88, 0.015);
            const spoke = new THREE.Mesh(spokeGeo, this.materials.metal);
            const angle = (i * Math.PI * 2) / 3 + wheelCfg.tilt;
            spoke.position.set(Math.cos(angle) * wheelCfg.rimRadius * 0.67, Math.sin(angle) * wheelCfg.rimRadius * 0.67, 0);
            spoke.rotation.set(wheelCfg.tilt, 0, angle);
            this.result.steeringWheelGroup.add(spoke);
        }

        const columnGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8);
        const column = new THREE.Mesh(columnGeo, this.materials.metal);
        column.position.set(
            wheelCfg.columnPosition.x,
            wheelCfg.columnPosition.y,
            wheelCfg.columnPosition.z,
        );
        column.rotation.set(wheelCfg.tilt, 0, 0);
        this.interiorGroup.add(column);

        this.buildWiperStalk(wheelCfg.columnPosition, wheelCfg.tilt);
    }

    /**
     * Wiper stalk on the right of the steering column. The pivot group carries
     * the column tilt so the detent rotation applied by the micro-interaction
     * layer reads as a clean up/down flick.
     */
    private buildWiperStalk(columnPosition: { x: number; y: number; z: number }, tilt: number): void {
        const pivot = new THREE.Group();
        pivot.position.set(columnPosition.x + 0.055, columnPosition.y + 0.12, columnPosition.z + 0.02);
        pivot.rotation.set(tilt, 0, 0);
        this.interiorGroup.add(pivot);

        const stalkGeo = new THREE.CylinderGeometry(0.008, 0.01, 0.16, 8);
        const stalk = new THREE.Mesh(stalkGeo, this.materials.metal);
        // Lay the cylinder along +X so it cantilevers out of the column.
        stalk.geometry.rotateZ(Math.PI / 2);
        stalk.geometry.translate(0.08, 0, 0);
        stalk.name = 'wiperStalk';
        pivot.add(stalk);

        const tipGeo = new THREE.SphereGeometry(0.012, 10, 8);
        const tip = new THREE.Mesh(tipGeo, this.materials.accent);
        tip.position.set(0.165, 0, 0);
        stalk.add(tip);

        this.result.wiperStalkMesh = stalk;
        this.result.wiperStalkPivot = pivot;
    }

    private buildDoorPanels(): void {
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

    private buildFloor(): void {
        const floorGeo = new THREE.PlaneGeometry(2.0, 2.5);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x141414,
            roughness: 0.97,
            metalness: 0.0,
            envMapIntensity: 0.05,
            side: THREE.DoubleSide,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.set(-Math.PI / 2, 0, 0);
        floor.position.set(0, 0.35, 0);
        this.interiorGroup.add(floor);
    }

    private buildFloorMats(): void {
        if (this.quality === 'low') return;

        const matMaterial = new THREE.MeshStandardMaterial({
            color: 0x1f1f1f,
            roughness: 0.85,
            metalness: 0.0,
        });

        const driverMatShape = new THREE.Shape();
        driverMatShape.moveTo(-0.42, 0.05);
        driverMatShape.lineTo(0.08, 0.05);
        driverMatShape.lineTo(0.12, 0.55);
        driverMatShape.quadraticCurveTo(0.1, 0.7, -0.1, 0.72);
        driverMatShape.lineTo(-0.38, 0.72);
        driverMatShape.quadraticCurveTo(-0.45, 0.4, -0.42, 0.05);

        const driverMatGeo = new THREE.ExtrudeGeometry(driverMatShape, {
            depth: 0.008,
            bevelEnabled: true,
            bevelThickness: 0.004,
            bevelSize: 0.004,
            bevelSegments: 2,
        });

        const driverMat = new THREE.Mesh(driverMatGeo, matMaterial);
        driverMat.rotation.x = -Math.PI / 2;
        driverMat.position.set(-0.35, 0.355, 0.15);
        this.interiorGroup.add(driverMat);

        const passMatShape = new THREE.Shape();
        passMatShape.moveTo(0.42, 0.05);
        passMatShape.lineTo(-0.08, 0.05);
        passMatShape.lineTo(-0.12, 0.55);
        passMatShape.quadraticCurveTo(-0.1, 0.7, 0.1, 0.72);
        passMatShape.lineTo(0.38, 0.72);
        passMatShape.quadraticCurveTo(0.45, 0.4, 0.42, 0.05);

        const passMatGeo = new THREE.ExtrudeGeometry(passMatShape, {
            depth: 0.008,
            bevelEnabled: true,
            bevelThickness: 0.004,
            bevelSize: 0.004,
            bevelSegments: 2,
        });

        const passMat = new THREE.Mesh(passMatGeo, matMaterial);
        passMat.rotation.x = -Math.PI / 2;
        passMat.position.set(0.35, 0.355, 0.15);
        this.interiorGroup.add(passMat);
    }

    private buildRoof(): void {
        const roofGeo = new THREE.BoxGeometry(2.0, 0.05, 2.0);
        const roofMat = new THREE.MeshStandardMaterial({
            color: 0x1e1e1e,
            roughness: 0.88,
            metalness: 0.02,
            envMapIntensity: 0.1,
            side: THREE.DoubleSide,
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(0, 1.6, 0);
        this.roofGroup.add(roof);
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

    private buildWindshieldGlass(): void {
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
        this.result.windshieldGlassMesh = new THREE.Mesh(geometry, glassMat);
        this.result.windshieldGlassMesh.name = 'windshieldGlass';
        this.result.windshieldGlassMesh.position.set(0, 1.3, -0.88);
        this.result.windshieldGlassMesh.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(this.result.windshieldGlassMesh);
    }

    private buildRearWindow(): void {
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
        this.result.rearGlassMesh = new THREE.Mesh(rearGlassGeo, rearGlassMat);
        this.result.rearGlassMesh.name = 'rearGlass';
        this.result.rearGlassMesh.position.set(0, 1.34, 0.64);
        this.interiorGroup.add(this.result.rearGlassMesh);

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
    }

    private buildSideMirrors(): void {
        const leftMirrorFrameGeo = new THREE.BoxGeometry(0.05, 0.25, 0.08);
        const leftMirrorFrame = new THREE.Mesh(leftMirrorFrameGeo, this.materials.frame);
        leftMirrorFrame.position.set(-1.0, 1.05, -0.5);
        leftMirrorFrame.rotation.set(0, 0.3, 0);
        this.interiorGroup.add(leftMirrorFrame);

        const leftMirrorPlaneGeo = new THREE.PlaneGeometry(0.15, 0.2);
        this.result.leftMirrorPlane = new THREE.Mesh(leftMirrorPlaneGeo, this.materials.mirror);
        this.result.leftMirrorPlane.position.set(-0.98, 1.05, -0.52);
        this.result.leftMirrorPlane.rotation.set(0, 0.5, 0);
        this.interiorGroup.add(this.result.leftMirrorPlane);

        const rightMirrorFrameGeo = new THREE.BoxGeometry(0.05, 0.25, 0.08);
        const rightMirrorFrame = new THREE.Mesh(rightMirrorFrameGeo, this.materials.frame);
        rightMirrorFrame.position.set(1.0, 1.05, -0.5);
        rightMirrorFrame.rotation.set(0, -0.3, 0);
        this.interiorGroup.add(rightMirrorFrame);

        const rightMirrorPlaneGeo = new THREE.PlaneGeometry(0.15, 0.2);
        this.result.rightMirrorPlane = new THREE.Mesh(rightMirrorPlaneGeo, this.materials.mirror);
        this.result.rightMirrorPlane.position.set(0.98, 1.05, -0.52);
        this.result.rightMirrorPlane.rotation.set(0, -0.5, 0);
        this.interiorGroup.add(this.result.rightMirrorPlane);
    }

    private buildWipers(): void {
        this.result.wiperLeft = new THREE.Group();
        this.result.wiperLeft.position.set(-0.2, 1.1, -0.9);
        this.interiorGroup.add(this.result.wiperLeft);

        const leftWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const leftWiperBlad = new THREE.Mesh(leftWiperBladGeo, this.materials.metal);
        leftWiperBlad.position.set(0, 0.15, 0);
        leftWiperBlad.rotation.set(0, 0, -Math.PI / 6);
        this.result.wiperLeft.add(leftWiperBlad);

        this.result.wiperRight = new THREE.Group();
        this.result.wiperRight.position.set(0.2, 1.1, -0.9);
        this.interiorGroup.add(this.result.wiperRight);

        const rightWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const rightWiperBlad = new THREE.Mesh(rightWiperBladGeo, this.materials.metal);
        rightWiperBlad.position.set(0, 0.15, 0);
        rightWiperBlad.rotation.set(0, 0, Math.PI / 6);
        this.result.wiperRight.add(rightWiperBlad);
    }

    private buildVehicleSpecificFeatures(): void {
        switch (this.vehicleConfig.type) {
            case 'science-lab':
                this.buildLabFeatures();
                break;
            case 'limousine':
                this.buildLimoFeatures();
                break;
            case 'convertible':
                this.buildConvertibleFeatures();
                break;
            default:
                break;
        }
    }

    private buildLabFeatures(): void {
        const monitorGeo = new THREE.BoxGeometry(0.4, 0.25, 0.05);
        const monitorMat = new THREE.MeshStandardMaterial({
            color: 0x000000,
            emissive: 0x004444,
            emissiveIntensity: 0.5,
            roughness: 0.2,
        });

        const monitor1 = new THREE.Mesh(monitorGeo, monitorMat);
        monitor1.position.set(0.2, 1.0, -0.72);
        this.interiorGroup.add(monitor1);

        const monitor2 = new THREE.Mesh(monitorGeo, monitorMat);
        monitor2.position.set(-0.2, 1.0, -0.72);
        this.interiorGroup.add(monitor2);

        const rackGeo = new THREE.BoxGeometry(1.8, 0.6, 0.3);
        const rackMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.4,
            metalness: 0.7,
        });
        const rack = new THREE.Mesh(rackGeo, rackMat);
        rack.position.set(0, 1.0, 0.8);
        this.interiorGroup.add(rack);
    }

    private buildLimoFeatures(): void {
        const barGeo = new THREE.BoxGeometry(0.25, 0.4, 0.6);
        const barMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.3,
            metalness: 0.5,
        });
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.set(0, 0.65, 0.4);
        this.interiorGroup.add(bar);

        for (let i = 0; i < 3; i++) {
            const holderGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8);
            const holderMat = new THREE.MeshStandardMaterial({
                color: 0xc0c0c0,
                roughness: 0.2,
                metalness: 0.9,
            });
            const holder = new THREE.Mesh(holderGeo, holderMat);
            holder.position.set(-0.08 + i * 0.08, 0.9, 0.5);
            this.interiorGroup.add(holder);
        }

        const dividerGeo = new THREE.BoxGeometry(1.6, 0.05, 0.02);
        const dividerMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.1,
            metalness: 0.1,
        });
        const divider = new THREE.Mesh(dividerGeo, dividerMat);
        divider.position.set(0, 1.4, 0.6);
        this.interiorGroup.add(divider);
    }

    private buildConvertibleFeatures(): void {
        const deflectorGeo = new THREE.BoxGeometry(1.4, 0.3, 0.02);
        const deflectorMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            transparent: true,
            opacity: 0.7,
            roughness: 0.1,
        });
        const deflector = new THREE.Mesh(deflectorGeo, deflectorMat);
        deflector.position.set(0, 1.2, 0.5);
        deflector.rotation.set(-0.2, 0, 0);
        this.interiorGroup.add(deflector);

        const sportHeadrestGeo = new THREE.BoxGeometry(0.18, 0.15, 0.06);
        const headrest = new THREE.Mesh(sportHeadrestGeo, this.materials.leather);
        headrest.position.set(-0.35, 1.3, 0.5);
        this.interiorGroup.add(headrest);
    }

    private buildDomeLightFixture(): void {
        const mountGroup = this.roofGroup ?? this.interiorGroup;

        const fixtureGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.015, 12);
        const fixtureMat = new THREE.MeshStandardMaterial({
            color: 0xddddcc, emissive: 0xFFE8B0, emissiveIntensity: 0,
            roughness: 0.4, metalness: 0.3,
        });
        this.result.domeLightFixtureMesh = new THREE.Mesh(fixtureGeo, fixtureMat);
        this.result.domeLightFixtureMesh.position.set(0, 1.59, 0.3);
        mountGroup.add(this.result.domeLightFixtureMesh);

        const switchGeo = new THREE.BoxGeometry(0.04, 0.008, 0.04);
        const switchMat = new THREE.MeshStandardMaterial({
            color: 0x333333, roughness: 0.7, metalness: 0.1,
            emissive: 0x111100, emissiveIntensity: 0,
        });
        this.result.domeSwitchMesh = new THREE.Mesh(switchGeo, switchMat);
        this.result.domeSwitchMesh.name = 'domeSwitch';
        this.result.domeSwitchMesh.position.set(-0.15, 1.55, -0.1);
        this.interiorGroup.add(this.result.domeSwitchMesh);
    }
}
