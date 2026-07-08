import * as THREE from 'three';
import { createCupLiquidMaterial } from '../../shaders/cupLiquid';
import type { CarInteriorMaterials } from './CarInteriorBuilder';
import type { InteriorInteractive } from './InteriorMicroInteractions';

export interface CarInteriorDetailBuildResult {
  interactives: InteriorInteractive[];
  cupLiquidMaterial?: THREE.ShaderMaterial;
  sunVisorGroup?: THREE.Group;
  vanityMirrorMesh?: THREE.Mesh;
}

/**
 * Small cabin props: shifter, pedals, cupholder + liquid, sun visor w/ vanity mirror.
 */
export class CarInteriorDetailProps {
  static build(
    interiorGroup: THREE.Group,
    materials: CarInteriorMaterials,
    quality: 'high' | 'medium' | 'low'
  ): CarInteriorDetailBuildResult {
    if (quality === 'low') {
      return { interactives: [] };
    }

    const interactives: InteriorInteractive[] = [];
    let cupLiquidMaterial: THREE.ShaderMaterial | undefined;
    let sunVisorGroup: THREE.Group | undefined;

    // --- Gear shifter ---
    const shifterGroup = new THREE.Group();
    shifterGroup.position.set(0.08, 0.62, 0.18);
    interiorGroup.add(shifterGroup);

    const bootGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.06, 12);
    const boot = new THREE.Mesh(bootGeo, materials.leather);
    boot.position.y = 0.03;
    shifterGroup.add(boot);

    const shaftGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.14, 8);
    const shaft = new THREE.Mesh(shaftGeo, materials.metal);
    shaft.position.y = 0.12;
    shifterGroup.add(shaft);

    const knobGeo = new THREE.SphereGeometry(0.028, 12, 10);
    const knob = new THREE.Mesh(knobGeo, materials.accent);
    knob.position.y = 0.2;
    knob.name = 'shifterKnob';
    shifterGroup.add(knob);

    interactives.push({
      mesh: knob,
      kind: 'knob',
      minRotation: -0.45,
      maxRotation: 0.45,
      axis: 'x',
    });

    // --- Pedal set ---
    const pedalMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.85,
      metalness: 0.15,
    });
    const pedalGeo = new THREE.BoxGeometry(0.1, 0.015, 0.14);

    const brake = new THREE.Mesh(pedalGeo, pedalMat);
    brake.position.set(-0.22, 0.38, 0.05);
    brake.rotation.x = -0.35;
    brake.name = 'brakePedal';
    interiorGroup.add(brake);

    const gas = new THREE.Mesh(pedalGeo, pedalMat);
    gas.position.set(-0.08, 0.38, 0.02);
    gas.rotation.x = -0.28;
    gas.name = 'gasPedal';
    interiorGroup.add(gas);

    interactives.push({
      mesh: brake,
      kind: 'button',
      pressDepth: 0.018,
      pressAxis: 'z',
    });
    interactives.push({
      mesh: gas,
      kind: 'button',
      pressDepth: 0.022,
      pressAxis: 'z',
    });

    // --- Cupholder + liquid ---
    const cupGroup = new THREE.Group();
    cupGroup.position.set(0.22, 0.58, 0.28);
    interiorGroup.add(cupGroup);

    const holderGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.05, 16, 1, true);
    const holder = new THREE.Mesh(holderGeo, materials.metal);
    cupGroup.add(holder);

    const cupGeo = new THREE.CylinderGeometry(0.032, 0.03, 0.09, 16);
    cupLiquidMaterial = createCupLiquidMaterial(0x4a2818);
    const cupLiquid = new THREE.Mesh(cupGeo, cupLiquidMaterial);
    cupLiquid.position.y = 0.04;
    cupLiquid.name = 'cupLiquid';
    cupGroup.add(cupLiquid);

    // --- Sun visor + vanity mirror ---
    sunVisorGroup = new THREE.Group();
    sunVisorGroup.position.set(-0.28, 1.48, -0.55);
    sunVisorGroup.rotation.x = -0.08;
    interiorGroup.add(sunVisorGroup);

    const visorPadGeo = new THREE.BoxGeometry(0.32, 0.02, 0.22);
    const visorPad = new THREE.Mesh(visorPadGeo, materials.leather);
    sunVisorGroup.add(visorPad);

    const mirrorGeo = new THREE.PlaneGeometry(0.12, 0.07);
    const vanityMirror = new THREE.Mesh(mirrorGeo, materials.mirror);
    vanityMirror.position.set(0, -0.015, 0.08);
    vanityMirror.rotation.x = -0.15;
    vanityMirror.name = 'vanityMirror';
    sunVisorGroup.add(vanityMirror);

    const visorLatchGeo = new THREE.BoxGeometry(0.04, 0.012, 0.02);
    const visorLatch = new THREE.Mesh(visorLatchGeo, materials.metal);
    visorLatch.position.set(0.12, 0, -0.05);
    visorLatch.name = 'visorLatch';
    sunVisorGroup.add(visorLatch);

    interactives.push({
      mesh: visorLatch,
      kind: 'button',
      pressDepth: 0.008,
      pressAxis: 'y',
      onPress: () => {
        sunVisorGroup!.rotation.x += sunVisorGroup!.rotation.x < -0.2 ? 0.35 : -0.35;
      },
    });

    // Hazard button on dash (micro-interaction)
    const hazardBtn = interiorGroup.getObjectByName('hazardBtn') as THREE.Mesh | undefined;
    if (hazardBtn) {
      interactives.push({
        mesh: hazardBtn,
        kind: 'button',
        pressDepth: 0.006,
        pressAxis: 'z',
      });
    }

    return { interactives, cupLiquidMaterial, sunVisorGroup, vanityMirrorMesh: vanityMirror };
  }
}
