import * as THREE from 'three';

export interface LimoState {
    partitionOpen: boolean;
    moodLighting: 'relaxing' | 'business' | 'party' | 'romantic';
    entertainmentOn: boolean;
    intercomActive: boolean;
    chauffeurView: boolean;
    barLightOn: boolean;
    screenContent: 'none' | 'nav' | 'entertainment' | 'ambient';
}

export const defaultLimoState: LimoState = {
    partitionOpen: false,
    moodLighting: 'relaxing',
    entertainmentOn: false,
    intercomActive: false,
    chauffeurView: false,
    barLightOn: true,
    screenContent: 'ambient',
};

export function applyPartitionGlass(
    material: THREE.MeshPhysicalMaterial,
    partitionOpen: boolean,
): void {
    material.opacity = partitionOpen ? 0.2 : 0.9;
    material.transmission = partitionOpen ? 0.8 : 0.1;
}

export function applyLimoMoodLighting(
    state: LimoState,
    moodLights: THREE.PointLight[],
    ambientLight: THREE.AmbientLight,
    barLight: THREE.PointLight,
): void {
    const moodColors: Record<string, number[]> = {
        relaxing: [0xff8844, 0xffaa66, 0xffcc88, 0xffddaa],
        business: [0xffffff, 0xffffee, 0xffffdd, 0xffffff],
        party: [0xff0088, 0x8800ff, 0x0088ff, 0x00ff88],
        romantic: [0xff4466, 0xff6688, 0xff88aa, 0xffaacc],
    };
    const colors = (moodColors[state.moodLighting] || moodColors.relaxing)!;
    const intensity = state.entertainmentOn ? 0.8 : 0.4;
    moodLights.forEach((light, idx) => {
        light.color.setHex(colors[idx % colors.length]!);
        light.intensity = intensity;
    });
    switch (state.moodLighting) {
        case 'relaxing':
            ambientLight.color.setHex(0xffddaa);
            ambientLight.intensity = 0.15;
            break;
        case 'business':
            ambientLight.color.setHex(0xffffff);
            ambientLight.intensity = 0.3;
            break;
        case 'party':
            ambientLight.color.setHex(0xff00ff);
            ambientLight.intensity = 0.1;
            break;
        case 'romantic':
            ambientLight.color.setHex(0xffaabb);
            ambientLight.intensity = 0.12;
            break;
    }
    barLight.intensity = state.barLightOn ? 0.5 : 0;
}

export function applyLimoScreenContent(
    screensGroup: THREE.Group,
    state: LimoState,
): void {
    const contentColors: Record<string, number> = {
        none: 0x000000,
        nav: 0x002244,
        entertainment: 0x440022,
        ambient: 0x112233,
    };
    const emissiveIntensity = state.entertainmentOn ? 0.8 : 0.2;
    const color = (contentColors[state.screenContent] || contentColors.ambient)!;
    screensGroup.children.forEach((child) => {
        if (child.name.includes('Screen')) {
            const mesh = child as THREE.Mesh;
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(color);
            mat.emissiveIntensity = emissiveIntensity;
        }
    });
}

export function tickLimoAtmosphere(
    state: LimoState,
    moodLights: THREE.PointLight[],
    ceilingLights: THREE.SpotLight[],
    nowSec: number,
): void {
    if (state.entertainmentOn && state.moodLighting === 'party') {
        moodLights.forEach((light, idx) => {
            const offset = idx * Math.PI / 2;
            light.intensity = 0.5 + Math.sin(nowSec * 2 + offset) * 0.3;
        });
    }
    ceilingLights.forEach((light, idx) => {
        light.intensity = 0.2 + Math.sin(nowSec * 0.5 + idx) * 0.1;
    });
}
