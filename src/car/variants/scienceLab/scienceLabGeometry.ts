import * as THREE from 'three';
import type { ScienceLabMaterials } from './scienceLabMaterials';
import { buildInstrumentDisplays as buildInstrumentDisplayWidgets } from './instrumentWidgets';

export interface ScienceLabLighting {
    uvLight: THREE.PointLight;
    taskLights: THREE.PointLight[];
}

export interface ScienceLabGeometryContext {
    labGroup: THREE.Group;
    equipmentGroup: THREE.Group;
    materials: ScienceLabMaterials;
    instrumentDisplays: THREE.Mesh[];
    displayMaterials: THREE.MeshStandardMaterial[];
    equipmentFans: THREE.Group[];
    sampleDrawers: THREE.Group[];
}

export function createScienceLabLighting(scene: THREE.Scene): ScienceLabLighting {
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const overheadLight1 = new THREE.DirectionalLight(0xfffff0, 0.7);
    overheadLight1.position.set(0, 2.5, 0);
    scene.add(overheadLight1);

    const taskLights: THREE.PointLight[] = [];
    const taskLight1 = new THREE.PointLight(0xffffff, 0.5, 4);
    taskLight1.position.set(0.3, 1.8, 0);
    taskLights.push(taskLight1);
    scene.add(taskLight1);

    const taskLight2 = new THREE.PointLight(0xffffff, 0.4, 3);
    taskLight2.position.set(-0.3, 1.8, 0.5);
    taskLights.push(taskLight2);
    scene.add(taskLight2);

    const uvLight = new THREE.PointLight(0x6600ff, 0, 5);
    uvLight.position.set(0.5, 1.6, 0.3);
    scene.add(uvLight);

    const instrumentGlow = new THREE.PointLight(0x00ff88, 0.3, 2);
    instrumentGlow.position.set(0.3, 1.0, -0.5);
    scene.add(instrumentGlow);

    return { uvLight, taskLights };
}

export function buildLabInterior(ctx: ScienceLabGeometryContext): void {
    buildLabFloor(ctx);
    buildDriverArea(ctx);
    buildEquipmentRack(ctx);
    buildBenchSeating(ctx);
    buildInstrumentDisplays(ctx);
    buildSampleStorage(ctx);
    buildRoof(ctx);
    buildSidePanels(ctx);
}

export function buildLabFloor(ctx: ScienceLabGeometryContext): void {
    const { labGroup, materials } = ctx;
    const floorGeo = new THREE.PlaneGeometry(2.0, 2.5);
    const floor = new THREE.Mesh(floorGeo, materials.rubberMatMaterial);
    floor.rotation.set(-Math.PI / 2, 0, 0);
    floor.position.set(0, 0.35, 0);
    labGroup.add(floor);

    const railGeo = new THREE.BoxGeometry(1.8, 0.02, 0.05);
    for (let i = 0; i < 4; i++) {
        const rail = new THREE.Mesh(railGeo, materials.metalMaterial);
        rail.position.set(0, 0.36, -0.8 + i * 0.6);
        labGroup.add(rail);
    }
}

export function buildDriverArea(ctx: ScienceLabGeometryContext): void {
    const { labGroup, materials } = ctx;
    const seatBackGeo = new THREE.BoxGeometry(0.5, 0.65, 0.1);
    const seatBack = new THREE.Mesh(seatBackGeo, materials.darkPlasticMaterial);
    seatBack.position.set(-0.35, 0.85, 0.5);
    seatBack.rotation.set(-0.1, 0, 0);
    labGroup.add(seatBack);

    const seatBottomGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
    const seatBottom = new THREE.Mesh(seatBottomGeo, materials.darkPlasticMaterial);
    seatBottom.position.set(-0.35, 0.5, 0.2);
    labGroup.add(seatBottom);

    const steeringColumnGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8);
    const steeringColumn = new THREE.Mesh(steeringColumnGeo, materials.metalMaterial);
    steeringColumn.position.set(-0.35, 0.78, -0.7);
    steeringColumn.rotation.set(Math.PI * 0.35, 0, 0);
    labGroup.add(steeringColumn);

    const wheelGeo = new THREE.TorusGeometry(0.16, 0.02, 8, 24);
    const wheel = new THREE.Mesh(wheelGeo, materials.darkPlasticMaterial);
    wheel.position.set(-0.35, 0.95, -0.6);
    wheel.rotation.set(Math.PI * 0.35, 0, 0);
    labGroup.add(wheel);

    const dashGeo = new THREE.BoxGeometry(0.8, 0.3, 0.4);
    const dash = new THREE.Mesh(dashGeo, materials.instrumentMaterial);
    dash.position.set(-0.35, 0.8, -1.0);
    labGroup.add(dash);
}

export function buildEquipmentRack(ctx: ScienceLabGeometryContext): void {
    const { equipmentGroup, materials, equipmentFans } = ctx;
    const rackFrameGeo = new THREE.BoxGeometry(0.6, 1.2, 0.5);
    const rackFrame = new THREE.Mesh(rackFrameGeo, materials.metalMaterial);
    rackFrame.position.set(0.5, 0.95, 0.3);
    equipmentGroup.add(rackFrame);

    for (let i = 0; i < 4; i++) {
        const shelfGeo = new THREE.BoxGeometry(0.55, 0.02, 0.45);
        const shelf = new THREE.Mesh(shelfGeo, materials.labBenchMaterial);
        shelf.position.set(0.5, 0.5 + i * 0.28, 0.3);
        equipmentGroup.add(shelf);
        addEquipmentToShelf(ctx, i, 0.5, 0.5 + i * 0.28, 0.3);
    }

    for (let i = 0; i < 2; i++) {
        const fanGroup = new THREE.Group();
        fanGroup.position.set(0.5, 1.4 - i * 0.3, 0.56);
        equipmentGroup.add(fanGroup);

        const housingGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 16);
        const housing = new THREE.Mesh(housingGeo, materials.darkPlasticMaterial);
        housing.rotation.x = Math.PI / 2;
        fanGroup.add(housing);

        const bladeGeo = new THREE.BoxGeometry(0.12, 0.02, 0.01);
        for (let b = 0; b < 4; b++) {
            const blade = new THREE.Mesh(bladeGeo, materials.metalMaterial);
            blade.rotation.z = (b * Math.PI) / 2;
            blade.position.z = 0.03;
            fanGroup.add(blade);
        }

        equipmentFans.push(fanGroup);
    }

    const cableTrayGeo = new THREE.BoxGeometry(0.5, 0.04, 0.1);
    const cableTray = new THREE.Mesh(cableTrayGeo, materials.darkPlasticMaterial);
    cableTray.position.set(0.5, 0.45, 0.55);
    equipmentGroup.add(cableTray);
}

function addEquipmentToShelf(
    ctx: ScienceLabGeometryContext,
    shelfIndex: number,
    x: number,
    y: number,
    z: number
): void {
    const { equipmentGroup, materials } = ctx;
    switch (shelfIndex) {
        case 0: {
            const specGeo = new THREE.BoxGeometry(0.2, 0.15, 0.25);
            const spec = new THREE.Mesh(specGeo, materials.whitePlasticMaterial);
            spec.position.set(x - 0.1, y + 0.075, z);
            equipmentGroup.add(spec);

            const specDisplayGeo = new THREE.PlaneGeometry(0.15, 0.08);
            const specDisplayMat = new THREE.MeshStandardMaterial({
                color: 0x000000,
                emissive: 0x00ff88,
                emissiveIntensity: 0.4,
            });
            const specDisplay = new THREE.Mesh(specDisplayGeo, specDisplayMat);
            specDisplay.position.set(x - 0.1, y + 0.12, z + 0.13);
            equipmentGroup.add(specDisplay);
            break;
        }
        case 1: {
            const centGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16);
            const cent = new THREE.Mesh(centGeo, materials.instrumentMaterial);
            cent.position.set(x, y + 0.1, z);
            equipmentGroup.add(cent);

            const lidGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.02, 16);
            const lid = new THREE.Mesh(lidGeo, materials.metalMaterial);
            lid.position.set(x, y + 0.21, z);
            equipmentGroup.add(lid);
            break;
        }
        case 2: {
            const incGeo = new THREE.BoxGeometry(0.25, 0.18, 0.2);
            const inc = new THREE.Mesh(incGeo, materials.whitePlasticMaterial);
            inc.position.set(x, y + 0.09, z);
            equipmentGroup.add(inc);

            const tempDisplayGeo = new THREE.PlaneGeometry(0.15, 0.06);
            const tempDisplayMat = new THREE.MeshStandardMaterial({
                color: 0x000000,
                emissive: 0xff4400,
                emissiveIntensity: 0.5,
            });
            const tempDisplay = new THREE.Mesh(tempDisplayGeo, tempDisplayMat);
            tempDisplay.position.set(x, y + 0.15, z + 0.11);
            equipmentGroup.add(tempDisplay);
            break;
        }
        case 3: {
            const phGeo = new THREE.BoxGeometry(0.12, 0.1, 0.15);
            const ph = new THREE.Mesh(phGeo, materials.darkPlasticMaterial);
            ph.position.set(x - 0.1, y + 0.05, z);
            equipmentGroup.add(ph);

            const probeGeo = new THREE.CylinderGeometry(0.008, 0.005, 0.15, 8);
            const probe = new THREE.Mesh(probeGeo, materials.glassMaterial);
            probe.position.set(x - 0.1, y + 0.12, z + 0.05);
            equipmentGroup.add(probe);
            break;
        }
    }
}

export function buildBenchSeating(ctx: ScienceLabGeometryContext): void {
    const { labGroup, materials } = ctx;
    const leftBenchGeo = new THREE.BoxGeometry(0.4, 0.08, 1.8);
    const leftBench = new THREE.Mesh(leftBenchGeo, materials.labBenchMaterial);
    leftBench.position.set(-0.8, 0.55, 0);
    labGroup.add(leftBench);

    const leftBackGeo = new THREE.BoxGeometry(0.08, 0.4, 1.8);
    const leftBack = new THREE.Mesh(leftBackGeo, materials.darkPlasticMaterial);
    leftBack.position.set(-0.95, 0.8, 0);
    leftBack.rotation.z = 0.1;
    labGroup.add(leftBack);

    const rightBenchGeo = new THREE.BoxGeometry(0.4, 0.08, 1.0);
    const rightBench = new THREE.Mesh(rightBenchGeo, materials.labBenchMaterial);
    rightBench.position.set(0.9, 0.55, -0.4);
    labGroup.add(rightBench);

    const rightBackGeo = new THREE.BoxGeometry(0.08, 0.4, 1.0);
    const rightBack = new THREE.Mesh(rightBackGeo, materials.darkPlasticMaterial);
    rightBack.position.set(1.05, 0.8, -0.4);
    rightBack.rotation.z = -0.1;
    labGroup.add(rightBack);

    for (let i = 0; i < 3; i++) {
        const cushionGeo = new THREE.BoxGeometry(0.35, 0.04, 0.4);
        const cushion = new THREE.Mesh(cushionGeo, materials.darkPlasticMaterial);
        cushion.position.set(-0.8, 0.62, -0.6 + i * 0.6);
        labGroup.add(cushion);
    }
}

export function buildInstrumentDisplays(ctx: ScienceLabGeometryContext): void {
    buildInstrumentDisplayWidgets(ctx);
}

export function buildSampleStorage(ctx: ScienceLabGeometryContext): void {
    const { labGroup, materials, sampleDrawers } = ctx;
    for (let i = 0; i < 3; i++) {
        const drawerGroup = new THREE.Group();
        drawerGroup.position.set(-0.6, 0.45 + i * 0.25, -0.8);
        labGroup.add(drawerGroup);
        sampleDrawers.push(drawerGroup);

        const housingGeo = new THREE.BoxGeometry(0.5, 0.2, 0.3);
        const housing = new THREE.Mesh(housingGeo, materials.metalMaterial);
        drawerGroup.add(housing);

        const frontGeo = new THREE.BoxGeometry(0.5, 0.18, 0.02);
        const front = new THREE.Mesh(frontGeo, materials.whitePlasticMaterial);
        front.position.z = 0.16;
        drawerGroup.add(front);

        const handleGeo = new THREE.BoxGeometry(0.15, 0.02, 0.03);
        const handle = new THREE.Mesh(handleGeo, materials.metalMaterial);
        handle.position.set(0, 0, 0.18);
        drawerGroup.add(handle);

        const labelGeo = new THREE.PlaneGeometry(0.2, 0.08);
        const labelMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.9,
        });
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.position.set(0, 0.04, 0.17);
        drawerGroup.add(label);
    }

    const fridgeGeo = new THREE.BoxGeometry(0.4, 0.35, 0.4);
    const fridge = new THREE.Mesh(fridgeGeo, materials.whitePlasticMaterial);
    fridge.position.set(0.9, 0.525, 0.4);
    labGroup.add(fridge);

    const fridgeDoorGeo = new THREE.BoxGeometry(0.4, 0.35, 0.03);
    const fridgeDoor = new THREE.Mesh(fridgeDoorGeo, materials.labBenchMaterial);
    fridgeDoor.position.set(0.9, 0.525, 0.6);
    labGroup.add(fridgeDoor);

    const fridgeHandleGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 8);
    const fridgeHandle = new THREE.Mesh(fridgeHandleGeo, materials.metalMaterial);
    fridgeHandle.position.set(0.75, 0.525, 0.62);
    labGroup.add(fridgeHandle);

    const tempIndicatorGeo = new THREE.CircleGeometry(0.03, 16);
    const tempIndicatorMat = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.6,
    });
    const tempIndicator = new THREE.Mesh(tempIndicatorGeo, tempIndicatorMat);
    tempIndicator.position.set(1.05, 0.6, 0.62);
    labGroup.add(tempIndicator);
}

export function buildRoof(ctx: ScienceLabGeometryContext): void {
    const { labGroup, materials } = ctx;
    const roofGeo = new THREE.BoxGeometry(2.0, 0.08, 2.2);
    const roofMat = new THREE.MeshStandardMaterial({
        color: 0xe0e0e0,
        roughness: 0.7,
        side: THREE.DoubleSide,
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, 1.65, 0);
    labGroup.add(roof);

    const roofEquipGeo = new THREE.BoxGeometry(0.8, 0.1, 0.6);
    const roofEquip = new THREE.Mesh(roofEquipGeo, materials.metalMaterial);
    roofEquip.position.set(0.3, 1.75, 0);
    labGroup.add(roofEquip);

    for (let i = 0; i < 3; i++) {
        const antennaGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.3, 8);
        const antenna = new THREE.Mesh(antennaGeo, materials.metalMaterial);
        antenna.position.set(0.1 + i * 0.2, 1.9, 0);
        labGroup.add(antenna);
    }

    const gpsGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const gps = new THREE.Mesh(gpsGeo, materials.whitePlasticMaterial);
    gps.position.set(-0.5, 1.75, 0.3);
    labGroup.add(gps);
}

export function buildSidePanels(ctx: ScienceLabGeometryContext): void {
    const { labGroup, materials } = ctx;
    const leftPanelGeo = new THREE.BoxGeometry(0.05, 1.2, 2.0);
    const leftPanel = new THREE.Mesh(leftPanelGeo, materials.instrumentMaterial);
    leftPanel.position.set(-1.0, 1.0, 0);
    labGroup.add(leftPanel);

    const rightPanelGeo = new THREE.BoxGeometry(0.05, 1.2, 2.0);
    const rightPanel = new THREE.Mesh(rightPanelGeo, materials.instrumentMaterial);
    rightPanel.position.set(1.0, 1.0, 0);
    labGroup.add(rightPanel);

    const windshieldGeo = new THREE.BoxGeometry(1.9, 0.05, 0.05);
    const windshield = new THREE.Mesh(windshieldGeo, materials.metalMaterial);
    windshield.position.set(0, 1.6, -0.9);
    labGroup.add(windshield);

    const pillarGeo = new THREE.BoxGeometry(0.06, 0.8, 0.06);

    const leftPillar = new THREE.Mesh(pillarGeo, materials.metalMaterial);
    leftPillar.position.set(-0.95, 1.3, -0.85);
    leftPillar.rotation.set(-0.2, 0, -0.1);
    labGroup.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, materials.metalMaterial);
    rightPillar.position.set(0.95, 1.3, -0.85);
    rightPillar.rotation.set(-0.2, 0, 0.1);
    labGroup.add(rightPillar);
}
