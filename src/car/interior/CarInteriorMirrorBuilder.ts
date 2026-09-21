import * as THREE from 'three';
import type { CarInteriorMaterials } from './CarInteriorBuilder';

export interface CarInteriorMirrorResult {
    leftMirrorPlane: THREE.Mesh;
    rightMirrorPlane: THREE.Mesh;
}

/**
 * Side mirror housings and their reflective planes.
 *
 * The planes are handed back by name (`SideMirrorL` / `SideMirrorR`) because
 * the rearview stack looks them up to swap in a live feed; the shared
 * `materials.mirror` is only the unavailable-state placeholder.
 */
export class CarInteriorMirrorBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private materials: CarInteriorMaterials,
    ) {}

    public build(): CarInteriorMirrorResult {
        const leftMirrorFrameGeo = new THREE.BoxGeometry(0.05, 0.25, 0.08);
        const leftMirrorFrame = new THREE.Mesh(leftMirrorFrameGeo, this.materials.frame);
        leftMirrorFrame.position.set(-1.0, 1.05, -0.5);
        leftMirrorFrame.rotation.set(0, 0.3, 0);
        this.interiorGroup.add(leftMirrorFrame);

        const leftMirrorPlaneGeo = new THREE.PlaneGeometry(0.15, 0.2);
        const leftMirrorPlane = new THREE.Mesh(leftMirrorPlaneGeo, this.materials.mirror);
        leftMirrorPlane.name = 'SideMirrorL';
        leftMirrorPlane.position.set(-0.98, 1.05, -0.52);
        leftMirrorPlane.rotation.set(0, 0.5, 0);
        this.interiorGroup.add(leftMirrorPlane);

        const rightMirrorFrameGeo = new THREE.BoxGeometry(0.05, 0.25, 0.08);
        const rightMirrorFrame = new THREE.Mesh(rightMirrorFrameGeo, this.materials.frame);
        rightMirrorFrame.position.set(1.0, 1.05, -0.5);
        rightMirrorFrame.rotation.set(0, -0.3, 0);
        this.interiorGroup.add(rightMirrorFrame);

        const rightMirrorPlaneGeo = new THREE.PlaneGeometry(0.15, 0.2);
        const rightMirrorPlane = new THREE.Mesh(rightMirrorPlaneGeo, this.materials.mirror);
        rightMirrorPlane.name = 'SideMirrorR';
        rightMirrorPlane.position.set(0.98, 1.05, -0.52);
        rightMirrorPlane.rotation.set(0, -0.5, 0);
        this.interiorGroup.add(rightMirrorPlane);

        return { leftMirrorPlane, rightMirrorPlane };
    }
}
