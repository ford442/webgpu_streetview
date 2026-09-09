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

export function createScienceLabLighting(scene: THREE.Object3D): ScienceLabLighting {
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

