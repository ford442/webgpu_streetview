import type * as THREE from 'three';

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
