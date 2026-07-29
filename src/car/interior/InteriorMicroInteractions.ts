import * as THREE from 'three';
import { InteractionHelper } from './InteractionHelper';

export type InteriorInteractiveKind = 'button' | 'knob' | 'lever';

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
  /** Lever: rotations (radians, along `axis`) of each detent position. */
  detents?: number[];
  /**
   * Lever: object the detent rotation is applied to. Defaults to `mesh`.
   * Use when the grab target (a shifter knob) is a child of the part that
   * should actually swing (the shifter assembly).
   */
  pivot?: THREE.Object3D;
  /** Lever: detent the control rests at when the cabin is (re)built (default 0). */
  initialDetent?: number;
  /** Lever: pointer axis the drag is measured along (default 'y'). */
  dragAxis?: 'x' | 'y';
  /** Lever: pixels of drag per detent step (default 26). */
  dragPixelsPerDetent?: number;
  /** Lever: fired whenever the selected detent changes. */
  onDetent?: (index: number) => void;
}

interface ActiveDrag {
  interactive: InteriorInteractive;
  startClientX: number;
  startClientY: number;
  startRotation: number;
  startIndex: number;
  moved: boolean;
}

/** A click that never travels further than this (px) cycles the lever instead of dragging it. */
const LEVER_CLICK_SLOP_PX = 5;

/**
 * Raycast-driven cabin micro-interactions: button depress, knob drag, and
 * detented levers (wiper stalk, gear shifter).
 * Spring-back and detent animation run in update().
 */
export class InteriorMicroInteractions {
  private readonly raycaster = new InteractionHelper();
  private readonly items: InteriorInteractive[] = [];
  private readonly restPositions = new Map<THREE.Mesh, THREE.Vector3>();
  private readonly restRotations = new Map<THREE.Mesh, number>();
  private readonly pressState = new Map<THREE.Mesh, number>();
  private readonly leverIndex = new Map<THREE.Mesh, number>();
  private activeDrag: ActiveDrag | null = null;
  private interiorEditMode = false;

  register(items: InteriorInteractive[]): void {
    this.items.length = 0;
    this.items.push(...items);
    this.activeDrag = null;
    this.leverIndex.clear();
    for (const item of items) {
      if (item.kind === 'button') {
        this.restPositions.set(item.mesh, item.mesh.position.clone());
        this.pressState.set(item.mesh, 0);
      } else if (item.kind === 'knob') {
        this.restRotations.set(item.mesh, this.readRotation(item));
      } else if (item.kind === 'lever') {
        const detents = item.detents ?? [];
        const initial = Math.min(Math.max(item.initialDetent ?? 0, 0), Math.max(detents.length - 1, 0));
        this.leverIndex.set(item.mesh, initial);
        this.writeRotation(item, detents[initial] ?? 0);
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

  private readRotation(item: InteriorInteractive): number {
    const axis = item.axis ?? 'z';
    const target = item.pivot ?? item.mesh;
    return axis === 'x' ? target.rotation.x : axis === 'y' ? target.rotation.y : target.rotation.z;
  }

  private writeRotation(item: InteriorInteractive, value: number): void {
    const axis = item.axis ?? 'z';
    const target = item.pivot ?? item.mesh;
    if (axis === 'x') target.rotation.x = value;
    else if (axis === 'y') target.rotation.y = value;
    else target.rotation.z = value;
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

    if (hit.kind === 'knob' || hit.kind === 'lever') {
      this.activeDrag = {
        interactive: hit,
        startClientX: clientX,
        startClientY: clientY,
        startRotation: this.readRotation(hit),
        startIndex: this.leverIndex.get(hit.mesh) ?? 0,
        moved: false,
      };
      return true;
    }
    return false;
  }

  handlePointerMove(clientX: number, clientY: number): boolean {
    const drag = this.activeDrag;
    if (!drag) return false;
    const { interactive, startClientX, startClientY, startRotation } = drag;

    if (interactive.kind === 'lever') {
      const detents = interactive.detents;
      if (!detents || detents.length === 0) return false;
      const dx = clientX - startClientX;
      const dy = clientY - startClientY;
      if (!drag.moved && Math.hypot(dx, dy) > LEVER_CLICK_SLOP_PX) drag.moved = true;
      if (!drag.moved) return true;
      // Dragging down (positive dy) or right steps toward later detents.
      const travel = (interactive.dragAxis ?? 'y') === 'x' ? dx : dy;
      const step = Math.round(travel / (interactive.dragPixelsPerDetent ?? 26));
      this.applyDetent(interactive, drag.startIndex + step);
      return true;
    }

    const delta = (clientX - startClientX) * 0.008;
    const min = interactive.minRotation ?? -Math.PI;
    const max = interactive.maxRotation ?? Math.PI;
    this.writeRotation(interactive, THREE.MathUtils.clamp(startRotation + delta, min, max));
    return true;
  }

  handlePointerUp(): void {
    const drag = this.activeDrag;
    this.activeDrag = null;
    if (!drag || drag.interactive.kind !== 'lever' || drag.moved) return;
    // Tap without travel: advance one detent, wrapping at the end.
    const detents = drag.interactive.detents;
    if (!detents || detents.length === 0) return;
    this.applyDetent(drag.interactive, (drag.startIndex + 1) % detents.length);
  }

  /** Move a lever to `index`, firing onDetent only when the position actually changes. */
  private applyDetent(item: InteriorInteractive, index: number, notify = true): void {
    const detents = item.detents;
    if (!detents || detents.length === 0) return;
    const clamped = THREE.MathUtils.clamp(index, 0, detents.length - 1);
    if ((this.leverIndex.get(item.mesh) ?? 0) === clamped) return;
    this.leverIndex.set(item.mesh, clamped);
    if (notify) item.onDetent?.(clamped);
  }

  /** Raycast-free press (e.g. W/S pedals from keyboard). */
  triggerPressByName(name: string): boolean {
    const item = this.items.find((i) => i.mesh.name === name && i.kind === 'button');
    if (!item) return false;
    this.pressState.set(item.mesh, 1);
    item.onPress?.();
    return true;
  }

  /**
   * Drive a lever from outside the 3D scene (HUD fallback, keyboard shortcut).
   * Does not fire onDetent — the caller already owns the state change.
   */
  setLeverIndexByName(name: string, index: number): boolean {
    const item = this.items.find((i) => i.mesh.name === name && i.kind === 'lever');
    if (!item) return false;
    this.applyDetent(item, index, false);
    return true;
  }

  getLeverIndexByName(name: string): number | null {
    const item = this.items.find((i) => i.mesh.name === name && i.kind === 'lever');
    if (!item) return null;
    return this.leverIndex.get(item.mesh) ?? 0;
  }

  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.1);
    for (const item of this.items) {
      if (item.kind === 'lever') {
        const detents = item.detents;
        if (!detents || detents.length === 0) continue;
        const target = detents[this.leverIndex.get(item.mesh) ?? 0] ?? 0;
        const current = this.readRotation(item);
        this.writeRotation(item, THREE.MathUtils.lerp(current, target, 1 - Math.pow(0.0001, dt)));
        continue;
      }
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
