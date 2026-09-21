import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { resolveSteeringWheel } from '../vehicleLayout';
import type { CarInteriorMaterials } from './CarInteriorBuilder';

export interface CarInteriorSteeringResult {
    steeringWheelGroup: THREE.Group;
    /** Wiper stalk lever — absent on vehicles without a steering wheel. */
    wiperStalkMesh: THREE.Mesh;
    wiperStalkPivot: THREE.Group;
}

/**
 * Steering wheel, column, and the wiper stalk hanging off it.
 *
 * Geometry is laid out around `resolveSteeringWheel(vehicleConfig)` so each
 * vehicle's rim radius, tilt, and column position stay in `vehicleLayout.ts`
 * rather than being duplicated per variant here.
 */
export class CarInteriorSteeringBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private materials: CarInteriorMaterials,
        private vehicleConfig: VehicleConfig,
    ) {}

    public build(): CarInteriorSteeringResult {
        const wheelCfg = resolveSteeringWheel(this.vehicleConfig);
        const steeringWheelGroup = new THREE.Group();
        steeringWheelGroup.name = 'SteeringWheel';
        steeringWheelGroup.position.set(
            wheelCfg.position.x,
            wheelCfg.position.y,
            wheelCfg.position.z,
        );
        this.interiorGroup.add(steeringWheelGroup);

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
        steeringWheelGroup.add(wheel);

        const hitGeo = new THREE.TorusGeometry(wheelCfg.rimRadius * 0.9, wheelCfg.rimRadius * 0.14, 8, 24);
        const hitMesh = new THREE.Mesh(
            hitGeo,
            new THREE.MeshBasicMaterial({ visible: false }),
        );
        hitMesh.name = 'SteeringWheelHit';
        hitMesh.rotation.set(wheelCfg.tilt, 0, 0);
        steeringWheelGroup.add(hitMesh);

        const hubGeo = new THREE.CylinderGeometry(wheelCfg.rimRadius * 0.33, wheelCfg.rimRadius * 0.33, 0.02, 16);
        const hub = new THREE.Mesh(hubGeo, this.materials.dashboard);
        hub.rotation.set(wheelCfg.tilt, 0, 0);
        steeringWheelGroup.add(hub);

        for (let i = 0; i < 3; i++) {
            const spokeGeo = new THREE.BoxGeometry(0.015, wheelCfg.rimRadius * 0.88, 0.015);
            const spoke = new THREE.Mesh(spokeGeo, this.materials.metal);
            const angle = (i * Math.PI * 2) / 3 + wheelCfg.tilt;
            spoke.position.set(Math.cos(angle) * wheelCfg.rimRadius * 0.67, Math.sin(angle) * wheelCfg.rimRadius * 0.67, 0);
            spoke.rotation.set(wheelCfg.tilt, 0, angle);
            steeringWheelGroup.add(spoke);
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

        const { wiperStalkMesh, wiperStalkPivot } = this.buildWiperStalk(
            wheelCfg.columnPosition,
            wheelCfg.tilt,
        );

        return { steeringWheelGroup, wiperStalkMesh, wiperStalkPivot };
    }

    /**
     * Wiper stalk on the right of the steering column. The pivot group carries
     * the column tilt so the detent rotation applied by the micro-interaction
     * layer reads as a clean up/down flick.
     */
    private buildWiperStalk(
        columnPosition: { x: number; y: number; z: number },
        tilt: number,
    ): { wiperStalkMesh: THREE.Mesh; wiperStalkPivot: THREE.Group } {
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

        return { wiperStalkMesh: stalk, wiperStalkPivot: pivot };
    }
}
