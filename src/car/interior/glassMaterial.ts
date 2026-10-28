import * as THREE from 'three';

/** Window glass for the WebGL cabin shell. */
export function createGlassMaterial(tintColor: string, darkness: number): THREE.MeshPhysicalMaterial {
    const color = new THREE.Color(tintColor).multiplyScalar(1 - darkness * 0.5);
    // transmission:0 and low opacity so the Three.js canvas stays mostly transparent —
    // this lets the WebGPU panorama canvas underneath show through the window openings.
    // Physical transmission (transmission:1) would render the Three.js scene background
    // (which is transparent/black) rather than the WebGPU panorama, making the glass opaque-black.
    return new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        envMapIntensity: 1.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        side: THREE.DoubleSide,
    });
}

