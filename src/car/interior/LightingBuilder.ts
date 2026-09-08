import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { isWebGPUCabinRenderer, type CabinRenderer } from './createCabinRenderer';

export interface InteriorLights {
  hemisphereLight: THREE.HemisphereLight;
  ambientLight: THREE.AmbientLight;
  overheadLight: THREE.DirectionalLight;
  leftWindowLight: THREE.PointLight | undefined;
  rightWindowLight: THREE.PointLight | undefined;
  headlightsLight: THREE.SpotLight;
  interiorBounceLight: THREE.PointLight;
  domeLightSource: THREE.PointLight;
  dashLight: THREE.PointLight;
  sunLight: THREE.DirectionalLight;
}

export interface InteriorLightingOptions {
  quality?: 'high' | 'medium' | 'low';
}

/**
 * Builds the complete lighting rig for a car interior.
 *
 * IBL ownership: this installs a *dim* room-cube PMREM as a fallback only.
 * `PanoEnvironment` replaces `scene.environment` on the first successful
 * pano hop and owns it thereafter — do not write scene.environment from
 * here after construction.
 *
 * Cabin sources (dash, dome, headlights, bounce, window fills) live on
 * `interiorGroup` so they stay in car-body space when the chassis yaws.
 * Hemisphere + sun stay on the scene root (world sky / sun).
 */
export function buildInteriorLighting(
  scene: THREE.Scene,
  interiorGroup: THREE.Group,
  renderer: CabinRenderer,
  config: VehicleConfig,
  options: InteriorLightingOptions = {},
): InteriorLights {
  const quality = options.quality ?? 'high';

  // classic THREE.PMREMGenerator is WebGL-only; the `?cabin=webgpu` escape
  // hatch skips the static studio-cube IBL fallback rather than crash. Real
  // reflections on that path are follow-up work — see createCabinRenderer.ts.
  if (!isWebGPUCabinRenderer(renderer)) {
    const envScene = new THREE.Scene();
    const envBoxGeo = new THREE.BoxGeometry(6, 4, 6);
    const envBoxMats = [
      new THREE.MeshBasicMaterial({ color: 0xc8bba8, side: THREE.BackSide }),
      new THREE.MeshBasicMaterial({ color: 0xb8b0a4, side: THREE.BackSide }),
      new THREE.MeshBasicMaterial({ color: 0xd8d4cc, side: THREE.BackSide }),
      new THREE.MeshBasicMaterial({ color: 0x1a1a1e, side: THREE.BackSide }),
      new THREE.MeshBasicMaterial({ color: 0xc4b8a8, side: THREE.BackSide }),
      new THREE.MeshBasicMaterial({ color: 0xb0a898, side: THREE.BackSide }),
    ];
    const envBox = new THREE.Mesh(envBoxGeo, envBoxMats);
    envScene.add(envBox);
    const envLight = new THREE.PointLight(0xfff5e0, 0.9, 10);
    envLight.position.set(0, 1.8, 0);
    envScene.add(envLight);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene).texture;
    pmrem.dispose();
    envBoxGeo.dispose();
    envBoxMats.forEach(m => m.dispose());
  }

  const hemisphereLight = new THREE.HemisphereLight(0xfff5e0, 0x1a1a28, 0.16);
  scene.add(hemisphereLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.035);
  scene.add(ambientLight);

  const dashColor = parseInt(config.accentColor.replace('#', '0x'));
  const dashLight = new THREE.PointLight(dashColor, 0, 1.7, 2);
  dashLight.position.set(0, 0.86, -0.78);
  interiorGroup.add(dashLight);

  const overheadLight = new THREE.DirectionalLight(0xfff8f0, 0.2);
  overheadLight.position.set(0.15, 1.7, -0.2);
  interiorGroup.add(overheadLight);

  let leftWindowLight: THREE.PointLight | undefined;
  let rightWindowLight: THREE.PointLight | undefined;
  if (quality !== 'low') {
    leftWindowLight = new THREE.PointLight(0xfff0dc, 0.13, 2.6, 2);
    leftWindowLight.position.set(-0.9, 1.05, -0.1);
    interiorGroup.add(leftWindowLight);

    rightWindowLight = new THREE.PointLight(0xfff0dc, 0.09, 2.6, 2);
    rightWindowLight.position.set(0.9, 1.05, -0.1);
    interiorGroup.add(rightWindowLight);
  }

  const headlightsLight = new THREE.SpotLight(0xffffcc, 0, 12, 0.42, 0.85, 1.4);
  headlightsLight.position.set(0, 0.78, -1.15);
  headlightsLight.target.position.set(0, 0.2, -8);
  interiorGroup.add(headlightsLight);
  interiorGroup.add(headlightsLight.target);

  const interiorBounceLight = new THREE.PointLight(0xffc080, 0, 1.4, 2);
  interiorBounceLight.position.set(0, 0.52, -0.7);
  interiorGroup.add(interiorBounceLight);

  const domeLightSource = new THREE.PointLight(0xffe8b0, 0, 2.2, 2);
  domeLightSource.position.set(0, 1.72, 0.3);
  interiorGroup.add(domeLightSource);

  // Real-sun directional light — world-fixed so it stays with the sky as the
  // car yaws. Position/colour/intensity come from SunCalc each update.
  const sunLight = new THREE.DirectionalLight(0xfff4e6, 0);
  sunLight.position.set(0, 20, 0);
  scene.add(sunLight);
  scene.add(sunLight.target);

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
    sunLight,
  };
}
