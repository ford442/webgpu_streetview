import * as THREE from 'three';
import { InteractionHelper } from './InteractionHelper';

export type InteriorInteractiveKind = 'button' | 'knob';

export interface InteriorInteractive {
  mesh: THREE.Mesh;
  kind: InteriorInteractiveKind;
  /** Button travel along local axis (metres). */
  pressDepth?: number;
  pressAxis?: 'x' | 'y' | 'z';
  /** Knob rotation limits (radians). */
  minRotation?: number;
  maxRotation?: number;
  axis?: 'x' | 'y' | 'z';
  onPress?: () => void;
}

interface ActiveDrag {
  interactive: InteriorInteractive;
  startClientX: number;
  startClientY: number;
  startRotation: number;
}

/**
 * Raycast-driven cabin micro-interactions: button depress + knob drag.
 * Spring-back animation runs in update().
 */
export class InteriorMicroInteractions {
  private readonly raycaster = new InteractionHelper();
  private readonly items: InteriorInteractive[] = [];
  private readonly restPositions = new Map<THREE.Mesh, THREE.Vector3>();
  private readonly restRotations = new Map<THREE.Mesh, number>();
  private readonly pressState = new Map<THREE.Mesh, number>();
  private activeDrag: ActiveDrag | null = null;
  private interiorEditMode = false;

  register(items: InteriorInteractive[]): void {
    this.items.length = 0;
    this.items.push(...items);
    for (const item of items) {
      if (item.kind === 'button') {
        this.restPositions.set(item.mesh, item.mesh.position.clone());
        this.pressState.set(item.mesh, 0);
      } else if (item.kind === 'knob') {
        const axis = item.axis ?? 'z';
        const rot = axis === 'x' ? item.mesh.rotation.x : axis === 'y' ? item.mesh.rotation.y : item.mesh.rotation.z;
        this.restRotations.set(item.mesh, rot);
      }
    }
  }

  setInteriorEditMode(enabled: boolean): void {
    this.interiorEditMode = enabled;
    if (!enabled) this.activeDrag = null;
  }

  isInteriorEditMode(): boolean {
    return this.interiorEditMode;
  }

  private findHit(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    camera: THREE.Camera,
    _root: THREE.Object3D
  ): InteriorInteractive | null {
    for (const item of this.items) {
      if (this.raycaster.hitTest(clientX, clientY, rect, camera, item.mesh, false)) {
        return item;
      }
    }
    // Fallback: search whole interior for named controls
    return null;
  }

  handlePointerDown(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    camera: THREE.Camera,
    root: THREE.Object3D,
    editMode: boolean
  ): boolean {
    if (!editMode) return false;
    const hit = this.findHit(clientX, clientY, rect, camera, root);
    if (!hit) return false;

    if (hit.kind === 'button') {
      this.pressState.set(hit.mesh, 1);
      hit.onPress?.();
      return true;
    }

    if (hit.kind === 'knob') {
      const axis = hit.axis ?? 'z';
      const rot = axis === 'x' ? hit.mesh.rotation.x : axis === 'y' ? hit.mesh.rotation.y : hit.mesh.rotation.z;
      this.activeDrag = {
        interactive: hit,
        startClientX: clientX,
        startClientY: clientY,
        startRotation: rot,
      };
      return true;
    }
    return false;
  }

  handlePointerMove(clientX: number, _clientY: number): boolean {
    if (!this.activeDrag || this.activeDrag.interactive.kind !== 'knob') return false;
    const { interactive, startClientX, startRotation } = this.activeDrag;
    const delta = (clientX - startClientX) * 0.008;
    const axis = interactive.axis ?? 'z';
    const min = interactive.minRotation ?? -Math.PI;
    const max = interactive.maxRotation ?? Math.PI;
    const next = THREE.MathUtils.clamp(startRotation + delta, min, max);
    if (axis === 'x') interactive.mesh.rotation.x = next;
    else if (axis === 'y') interactive.mesh.rotation.y = next;
    else interactive.mesh.rotation.z = next;
    return true;
  }

  handlePointerUp(): void {
    this.activeDrag = null;
  }

  /** Raycast-free press (e.g. W/S pedals from keyboard). */
  triggerPressByName(name: string): boolean {
    const item = this.items.find((i) => i.mesh.name === name && i.kind === 'button');
    if (!item) return false;
    this.pressState.set(item.mesh, 1);
    item.onPress?.();
    return true;
  }

  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.1);
    for (const item of this.items) {
      if (item.kind !== 'button') continue;
      const rest = this.restPositions.get(item.mesh);
      if (!rest) continue;
      const target = this.pressState.get(item.mesh) ?? 0;
      const current = item.mesh.userData.__pressT ?? 0;
      const next = THREE.MathUtils.lerp(current, target, 1 - Math.pow(0.0001, dt));
      item.mesh.userData.__pressT = next;
      if (target > 0.5 && next > 0.85) {
        this.pressState.set(item.mesh, 0);
      }
      const depth = (item.pressDepth ?? 0.008) * next;
      const axis = item.pressAxis ?? 'z';
      item.mesh.position.copy(rest);
      if (axis === 'x') item.mesh.position.x -= depth;
      else if (axis === 'y') item.mesh.position.y -= depth;
      else item.mesh.position.z -= depth;
    }
  }
}
