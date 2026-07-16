import * as THREE from 'three';
import { FrustumCuller } from '../../utils/performance';

/**
 * Manages InstancedMesh pools for repetitive small parts (bolts, handles, vents)
 * and simple LOD switching (hide distant detail meshes).
 *
 * Target: reduce draw calls from ~150 → <30.
 */
export class LODManager {
  private instances = new Map<string, THREE.InstancedMesh>();
  private detailMeshes: THREE.Mesh[] = [];
  private frustumCuller: FrustumCuller;

  constructor(frustumCuller: FrustumCuller) {
    this.frustumCuller = frustumCuller;
  }

  /**
   * Register a batch of identical meshes as a single InstancedMesh.
   * @param name   unique id for this batch
   * @param geo    shared geometry
   * @param mat    shared material
   * @param count  max instance count
   */
  registerBatch(
    name: string,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    count: number
  ): void {
    const existing = this.instances.get(name);
    if (existing) {
      // Re-registering (e.g. interior rebuild on vehicle swap): reset the
      // batch so addInstance calls repopulate it instead of overflowing.
      existing.count = 0;
      return;
    }
    const im = new THREE.InstancedMesh(geo, mat, count);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0; // start empty
    this.instances.set(name, im);
  }

  /** Get the InstancedMesh for a given batch so it can be added to scene */
  getBatch(name: string): THREE.InstancedMesh | undefined {
    return this.instances.get(name);
  }

  /** Append one instance to a batch. Returns false if batch full. */
  addInstance(name: string, matrix: THREE.Matrix4): boolean {
    const im = this.instances.get(name);
    if (!im) return false;
    if (im.count >= im.instanceMatrix.count) return false;
    im.setMatrixAt(im.count, matrix);
    im.count++;
    return true;
  }

  /** Finalize all batches (call after all instances added). */
  finalize(): void {
    this.instances.forEach(im => {
      im.instanceMatrix.needsUpdate = true;
    });
  }

  /** Register a detail mesh that can be culled at distance. */
  registerDetail(mesh: THREE.Mesh): void {
    this.detailMeshes.push(mesh);
  }

  /** Update LOD visibility based on camera distance / frustum. */
  updateLOD(camera: THREE.Camera): void {
    this.frustumCuller.update(camera);
    // Hide small detail meshes when they are far from camera
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    for (const mesh of this.detailMeshes) {
      const d = mesh.getWorldPosition(new THREE.Vector3()).distanceTo(camPos);
      mesh.visible = d < 2.5; // hide bolts/trim beyond 2.5m
    }
  }

  dispose(): void {
    this.instances.forEach(im => {
      im.geometry.dispose();
      // don't dispose material here — shared elsewhere
    });
    this.instances.clear();
    this.detailMeshes = [];
  }
}
