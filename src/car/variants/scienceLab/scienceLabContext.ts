import type * as THREE from 'three';
import type { ScienceLabMaterials } from './scienceLabMaterials';

export interface ScienceLabGeometryContext {
    labGroup: THREE.Group;
    equipmentGroup: THREE.Group;
    materials: ScienceLabMaterials;
    instrumentDisplays: THREE.Mesh[];
    displayMaterials: THREE.MeshStandardMaterial[];
    equipmentFans: THREE.Group[];
    sampleDrawers: THREE.Group[];
}
