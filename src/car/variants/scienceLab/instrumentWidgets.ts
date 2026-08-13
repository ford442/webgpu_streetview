import * as THREE from 'three';
import type { ScienceLabGeometryContext } from './scienceLabGeometry';

export interface LabInstrumentOverlay {
    speedKmh?: number;
    heading?: number;
    sunAltitude?: number;
}

const DISPLAY_CONFIGS: { pos: [number, number, number]; color: number; label: string }[] = [
    { pos: [0.25, 1.3, -0.67], color: 0x00ff88, label: 'SPEC' },
    { pos: [0.5, 1.3, -0.67], color: 0x0088ff, label: 'DATA' },
    { pos: [0.75, 1.3, -0.67], color: 0xff8800, label: 'TEMP' },
];

/** Procedural instrument screens + LEDs for the science-lab rack. */
export function buildInstrumentDisplays(ctx: ScienceLabGeometryContext): void {
    const { labGroup, equipmentGroup, materials, instrumentDisplays, displayMaterials } = ctx;
    const panelGeo = new THREE.BoxGeometry(0.7, 0.25, 0.05);
    const panel = new THREE.Mesh(panelGeo, materials.instrumentMaterial);
    panel.position.set(0.5, 1.3, -0.7);
    equipmentGroup.add(panel);

    DISPLAY_CONFIGS.forEach((config) => {
        const frameGeo = new THREE.BoxGeometry(0.18, 0.15, 0.02);
        const frame = new THREE.Mesh(frameGeo, materials.darkPlasticMaterial);
        frame.position.set(config.pos[0], config.pos[1], config.pos[2]);
        equipmentGroup.add(frame);

        const screenGeo = new THREE.PlaneGeometry(0.15, 0.12);
        const screenMat = new THREE.MeshStandardMaterial({
            color: 0x000000,
            emissive: config.color,
            emissiveIntensity: 0.3,
        });
        displayMaterials.push(screenMat);
        const screen = new THREE.Mesh(screenGeo, screenMat);
        screen.position.set(config.pos[0], config.pos[1], config.pos[2] + 0.02);
        screen.name = `labInstrument:${config.label}`;
        equipmentGroup.add(screen);
        instrumentDisplays.push(screen);

        const ledGeo = new THREE.SphereGeometry(0.01, 8, 8);
        const ledMat = new THREE.MeshStandardMaterial({
            color: config.color,
            emissive: config.color,
            emissiveIntensity: 0.8,
        });
        const led = new THREE.Mesh(ledGeo, ledMat);
        led.position.set(config.pos[0] + 0.06, config.pos[1] - 0.06, config.pos[2] + 0.02);
        equipmentGroup.add(led);
    });

    const sidePanelGeo = new THREE.BoxGeometry(0.05, 0.4, 0.6);
    const sidePanel = new THREE.Mesh(sidePanelGeo, materials.instrumentMaterial);
    sidePanel.position.set(-0.98, 1.1, 0);
    labGroup.add(sidePanel);

    for (let i = 0; i < 2; i++) {
        const sideDisplayGeo = new THREE.PlaneGeometry(0.4, 0.15);
        const sideDisplayMat = new THREE.MeshStandardMaterial({
            color: 0x000000,
            emissive: i === 0 ? 0xff0000 : 0xffff00,
            emissiveIntensity: 0.2,
        });
        const sideDisplay = new THREE.Mesh(sideDisplayGeo, sideDisplayMat);
        sideDisplay.rotation.y = Math.PI / 2;
        sideDisplay.position.set(-0.95, 1.1 + (i === 0 ? 0.1 : -0.1), 0);
        labGroup.add(sideDisplay);
    }
}

/** Tint the DATA screen from live vehicle/weather uniforms (optional overlay). */
export function applyLabInstrumentOverlay(
    displayMaterials: THREE.MeshStandardMaterial[],
    overlay: LabInstrumentOverlay,
): void {
    const dataMat = displayMaterials[1];
    if (!dataMat) return;
    const speed = overlay.speedKmh ?? 0;
    const sun = overlay.sunAltitude ?? 0;
    dataMat.emissiveIntensity = 0.25 + Math.min(0.45, speed / 200) + Math.max(0, sun) * 0.1;
}
