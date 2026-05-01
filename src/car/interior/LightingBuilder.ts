import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';

export interface InteriorLights {
  hemisphereLight: THREE.HemisphereLight;
  ambientLight: THREE.AmbientLight;
  overheadLight: THREE.DirectionalLight;
  leftWindowLight: THREE.PointLight;
  rightWindowLight: THREE.PointLight;
  headlightsLight: THREE.SpotLight;
  interiorBounceLight: THREE.PointLight;
  domeLightSource: THREE.PointLight;
  dashLight: THREE.PointLight;
}

/**
 * Builds the complete lighting rig for a car interior.
 * Includes IBL environment map, ambient fills, window lights,
 * headlights, dome light, and dashboard accent glow.
 */
export function buildInteriorLighting(
  scene: THREE.Scene,
  interiorGroup: THREE.Group,
  renderer: THREE.WebGLRenderer,
  config: VehicleConfig
): InteriorLights {
  // IBL environment map from a minimal lit-room cube
  const envScene = new THREE.Scene();
  const envBoxGeo = new THREE.BoxGeometry(6, 4, 6);
  const envBoxMats = [
    new THREE.MeshBasicMaterial({ color: 0xfff5e0, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: 0xe8e0d0, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: 0xfafaf8, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1e, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: 0xfff0e4, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: 0xe4dcd0, side: THREE.BackSide }),
  ];
  const envBox = new THREE.Mesh(envBoxGeo, envBoxMats);
  envScene.add(envBox);
  const envLight = new THREE.PointLight(0xfff5e0, 2.5, 10);
  envLight.position.set(0, 1.8, 0);
  envScene.add(envLight);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene).texture;
  pmrem.dispose();
  envBoxGeo.dispose();
  envBoxMats.forEach(m => m.dispose());

  const ambientIntensity = config.theme === 'clinical' ? 0.65 : 0.45;

  const hemisphereLight = new THREE.HemisphereLight(
    0xfff5e0, 0x1a1a28, ambientIntensity * 0.85
  );
  scene.add(hemisphereLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity * 0.25);
  scene.add(ambientLight);

  const dashColor = parseInt(config.accentColor.replace('#', '0x'));
  const dashLight = new THREE.PointLight(dashColor, 0.35, 3.5);
  dashLight.position.set(0, 0.9, -0.8);
  scene.add(dashLight);

  const overheadLight = new THREE.DirectionalLight(0xfff8f0, 0.55);
  overheadLight.position.set(0.3, 3, -0.5);
  scene.add(overheadLight);

  const leftWindowLight = new THREE.PointLight(0xfff0dc, 0.28, 3.2);
  leftWindowLight.position.set(-0.9, 1.05, -0.1);
  scene.add(leftWindowLight);

  const rightWindowLight = new THREE.PointLight(0xfff0dc, 0.18, 3.2);
  rightWindowLight.position.set(0.9, 1.05, -0.1);
  scene.add(rightWindowLight);

  const headlightsLight = new THREE.SpotLight(0xffffcc, 0.3, 50, 0.5, 1.0, 1.0);
  headlightsLight.position.set(0, 0.8, -1.2);
  headlightsLight.target.position.set(0, 0, 10);
  scene.add(headlightsLight);
  scene.add(headlightsLight.target);
  headlightsLight.intensity = 0;

  const interiorBounceLight = new THREE.PointLight(0xff9933, 0, 1.5);
  interiorBounceLight.position.set(0, 0.5, -0.8);
  scene.add(interiorBounceLight);

  const domeLightSource = new THREE.PointLight(0xffe8b0, 0, 3.0);
  domeLightSource.position.set(0, 1.8, 0.3);
  interiorGroup.add(domeLightSource);

  return {
    hemisphereLight,
    ambientLight,
    overheadLight,
    leftWindowLight,
    rightWindowLight,
    headlightsLight,
    interiorBounceLight,
    domeLightSource,
    dashLight,
  };
}
