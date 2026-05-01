import * as THREE from 'three';

/**
 * Cached raycaster + NDC conversion for dashboard hit-tests.
 * Re-uses the same Raycaster instance across frames to avoid GC pressure.
 */
export class InteractionHelper {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  /** Convert clientX/Y → NDC ([-1, 1]) */
  private setNDC(clientX: number, clientY: number, rect: DOMRect) {
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Generic hit-test against a single object or group */
  public hitTest(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    camera: THREE.Camera,
    target: THREE.Object3D,
    recursive = true
  ): boolean {
    this.setNDC(clientX, clientY, rect);
    this.raycaster.setFromCamera(this.ndc, camera);
    target.updateWorldMatrix(true, true);
    return this.raycaster.intersectObject(target, recursive).length > 0;
  }
}
