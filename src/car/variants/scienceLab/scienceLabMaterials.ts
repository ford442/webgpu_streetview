import * as THREE from 'three';

export interface ScienceLabMaterials {
    metalMaterial: THREE.MeshStandardMaterial;
    labBenchMaterial: THREE.MeshStandardMaterial;
    instrumentMaterial: THREE.MeshStandardMaterial;
    whitePlasticMaterial: THREE.MeshStandardMaterial;
    darkPlasticMaterial: THREE.MeshStandardMaterial;
    glassMaterial: THREE.MeshStandardMaterial;
    rubberMatMaterial: THREE.MeshStandardMaterial;
}

export function createScienceLabMaterials(): ScienceLabMaterials {
    return {
        metalMaterial: new THREE.MeshStandardMaterial({
            color: 0x888899,
            roughness: 0.4,
            metalness: 0.7,
            side: THREE.DoubleSide,
        }),
        labBenchMaterial: new THREE.MeshStandardMaterial({
            color: 0xf5f5f0,
            roughness: 0.3,
            metalness: 0.1,
            side: THREE.DoubleSide,
        }),
        instrumentMaterial: new THREE.MeshStandardMaterial({
            color: 0x2a2a35,
            roughness: 0.5,
            metalness: 0.3,
            side: THREE.DoubleSide,
        }),
        whitePlasticMaterial: new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            roughness: 0.6,
            metalness: 0.0,
            side: THREE.DoubleSide,
        }),
        darkPlasticMaterial: new THREE.MeshStandardMaterial({
            color: 0x1a1a20,
            roughness: 0.7,
            metalness: 0.1,
            side: THREE.DoubleSide,
        }),
        glassMaterial: new THREE.MeshStandardMaterial({
            color: 0xccddff,
            roughness: 0.1,
            metalness: 0.1,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
        }),
        rubberMatMaterial: new THREE.MeshStandardMaterial({
            color: 0x333340,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide,
        }),
    };
}
