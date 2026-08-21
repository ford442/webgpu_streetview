import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WindowWeatherOverlay } from './WindowWeatherOverlay';

function overlayPhase(overlay: WindowWeatherOverlay): number {
  const mat = overlay.getMesh().material as THREE.ShaderMaterial;
  return mat.uniforms.wiperPhase!.value as number;
}

describe('WindowWeatherOverlay wiper phase', () => {
  it('does not free-run phase in update — animator is the only writer', () => {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    const overlay = new WindowWeatherOverlay(glass);
    overlay.setWipersActive(true, 0.25);
    expect(overlayPhase(overlay)).toBeCloseTo(0.25);
    overlay.update(1.0);
    expect(overlayPhase(overlay)).toBeCloseTo(0.25);
    overlay.setWipersActive(true, 0.6);
    expect(overlayPhase(overlay)).toBeCloseTo(0.6);
    overlay.dispose();
  });
});
