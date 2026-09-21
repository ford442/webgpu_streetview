import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { createGlassMaterial } from '../../materials/PBRMaterials';
import { createCabinGlowSprite, type CabinGlowSprite } from './CabinEmitterGlow';

export interface CarInteriorShellResult {
    domeLightFixtureMesh: THREE.Mesh;
    domeSwitchMesh: THREE.Mesh;
    /** Dome glow sprite, when quality allows one. Appended to the shared list. */
    glowSprites: CabinGlowSprite[];
}

/**
 * The cabin box itself: floor, floor mats, roof, and the dome light.
 *
 * The dome fixture and its glow mount on `roofGroup` (so they ride the roof
 * open/close animation) while the wall switch stays on `interiorGroup`.
 * Emissive intensities start at 0 — `CarInteriorLightingManager` raises them.
 */
export class CarInteriorShellBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private roofGroup: THREE.Group,
        private vehicleConfig: VehicleConfig,
        private quality: 'high' | 'medium' | 'low',
        private reducedMotion: boolean = false,
    ) {}

    /** Floor, mats, and roof. Runs before the variant plugins. */
    public buildCabin(): void {
        this.buildFloor();
        this.buildFloorMats();
        if (this.vehicleConfig.hasRoof) this.buildRoof();
    }

    /**
     * Dome fixture, its glow sprite, and the wall switch. Kept separate from
     * `buildCabin` because it is the last thing built, so its glow sprite lands
     * at the end of the shared list the lighting manager walks.
     */
    public buildDomeLight(): CarInteriorShellResult {
        return this.buildDomeLightFixture();
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
        if (this.vehicleConfig.type === 'cortianics') {
            const roofFrameGeo = new THREE.BoxGeometry(2.0, 0.04, 2.0);
            const roofFrameMat = new THREE.MeshStandardMaterial({
                color: 0x0f1012,
                roughness: 0.82,
                metalness: 0.06,
                envMapIntensity: 0.12,
                side: THREE.DoubleSide,
            });
            const roofFrame = new THREE.Mesh(roofFrameGeo, roofFrameMat);
            roofFrame.position.set(0, 1.62, 0);
            this.roofGroup.add(roofFrame);

            const panoramicGlass = new THREE.Mesh(
                new THREE.BoxGeometry(1.55, 0.02, 1.55),
                createGlassMaterial('#7f9cb0', 0.12),
            );
            panoramicGlass.name = 'CortianicsPanoramicRoof';
            panoramicGlass.position.set(0, 1.58, 0);
            this.roofGroup.add(panoramicGlass);
            return;
        }

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

    private buildDomeLightFixture(): CarInteriorShellResult {
        const mountGroup = this.roofGroup ?? this.interiorGroup;
        const glowSprites: CabinGlowSprite[] = [];

        const fixtureGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.012, 24);
        const fixtureMat = new THREE.MeshStandardMaterial({
            color: 0xf2ead8, emissive: 0xFFE8B0, emissiveIntensity: 0,
            roughness: 0.28, metalness: 0.15,
        });
        const domeLightFixtureMesh = new THREE.Mesh(fixtureGeo, fixtureMat);
        domeLightFixtureMesh.position.set(0, 1.59, 0.3);
        mountGroup.add(domeLightFixtureMesh);

        if (this.quality !== 'low') {
            const domeGlow = createCabinGlowSprite({
                kind: 'dome',
                color: 0xffe8b0,
                width: 0.42,
                height: 0.42,
                useShader: this.quality === 'high',
                reducedMotion: this.reducedMotion,
            });
            domeGlow.mesh.position.set(0, 1.545, 0.3);
            domeGlow.mesh.rotation.set(-Math.PI / 2, 0, 0);
            mountGroup.add(domeGlow.mesh);
            glowSprites.push(domeGlow);
        }

        const switchGeo = new THREE.BoxGeometry(0.04, 0.008, 0.04);
        const switchMat = new THREE.MeshStandardMaterial({
            color: 0x333333, roughness: 0.7, metalness: 0.1,
            emissive: 0x111100, emissiveIntensity: 0,
        });
        const domeSwitchMesh = new THREE.Mesh(switchGeo, switchMat);
        domeSwitchMesh.name = 'domeSwitch';
        domeSwitchMesh.position.set(-0.15, 1.55, -0.1);
        this.interiorGroup.add(domeSwitchMesh);

        return { domeLightFixtureMesh, domeSwitchMesh, glowSprites };
    }
}
