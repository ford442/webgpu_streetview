import * as THREE from 'three';
import {
  createWindowWeatherOverlayMaterial,
  type WindowWeatherOverlayUniforms,
} from '../../shaders/windowWeatherOverlay';
import { getCabinMaterialBackend } from './cabinMaterialBackend';
import { publishCabinPortalState } from './cabinRendererProbe';
import type { CabinTslApi } from './cabinTslMaterials';
import { getCabinTslApi } from './cabinTslRegistry';
import { WindshieldPortal, type PortalFrameState } from './WindshieldPortal';
import {
  getWindshieldPortalSupport,
  type WindshieldPortalSupport,
} from './windshieldPortalSupport';

type OverlayMaterial = THREE.Material & { uniforms: WindowWeatherOverlayUniforms };

/** Below this rain the glass is "dry"; wiping then seeds a light mist so the blades read. */
const DRY_RAIN = 0.08;
const WIPING_MIST_RAIN = 0.12;

export interface WindowWeatherOverlayDeps {
  /** Overrides `getWindshieldPortalSupport()` — tests. */
  support?: WindshieldPortalSupport;
  /** Overrides `getCabinTslApi()` — tests. */
  tsl?: CabinTslApi;
  /** Clip-aperture inset for the portal (mesh units); see `windshieldAperture.ts`. */
  apertureInset?: number;
}

/**
 * The windshield's weather layer — rain and condensation on the glass, wiper
 * phase synced from `CarInteriorAnimator`.
 *
 * Two implementations behind one API, chosen once per cabin build:
 *
 * - **Portal** (`WindshieldPortal`): on the WebGPU cabin, when the shared device
 *   has `clip-distances`. Droplet lenses sample the road's HDR intermediate and a
 *   persistent wet mask records where the wipers have been.
 * - **Decal** (this class's own material): everywhere else — the `?cabin=webgl`
 *   hatch (GLSL), and the WebGPU cabin without `clip-distances` (TSL twin). A
 *   transparent shader layer over the hole the glass leaves onto the road.
 *
 * The decal mesh is always built. It is what shows whenever the portal is not
 * live — no road frame yet, renderer torn down, device lost — so the glass
 * degrades to exactly the pre-portal look rather than to nothing. Only one of the
 * two is ever visible.
 */
export class WindowWeatherOverlay {
  private mesh!: THREE.Mesh;
  private material!: OverlayMaterial;
  private readonly root: THREE.Object3D;
  private portal?: WindshieldPortal;
  private readonly support: WindshieldPortalSupport;
  private wipersActive = false;
  private lastRain = 0;
  private lastCondensation = 0;
  /** What the probe last said, so a steady state costs no allocation per frame. */
  private published?: { live: boolean; held: boolean; format?: string; reason?: string };

  constructor(windshield: THREE.Mesh, deps: WindowWeatherOverlayDeps = {}) {
    const geometry = windshield.geometry.clone();
    const backend = getCabinMaterialBackend();
    const tsl = backend === 'webgpu' ? (deps.tsl ?? getCabinTslApi()) : undefined;
    this.material = (tsl
      ? tsl.createWindowWeatherOverlayMaterial()
      : createWindowWeatherOverlayMaterial()) as OverlayMaterial;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'windowWeatherOverlay';
    this.mesh.position.copy(windshield.position);
    this.mesh.rotation.copy(windshield.rotation);
    this.mesh.scale.copy(windshield.scale);
    // Nudge toward cabin so it draws on top of glass without z-fighting.
    this.mesh.position.z += 0.012;
    this.mesh.renderOrder = 1;

    this.root = this.mesh;
    const support = deps.support ?? getWindshieldPortalSupport();
    this.support = support;
    if (tsl && support.enabled) {
      this.portal = new WindshieldPortal(tsl, this.mesh, windshield, {
        apertureInset: deps.apertureInset,
        cabinDevice: support.device,
      });
      // Identity-transform parent: the decal keeps its local transform, and the
      // portal's clipping group sits in the same frame the aperture planes were
      // authored in.
      const layers = new THREE.Group();
      layers.name = 'windowWeatherLayers';
      layers.add(this.mesh, this.portal.root);
      this.root = layers;
    }
    this.publishPortal(
      { live: false, held: false },
      this.portal ? 'No road HDR frame yet — hole + decal overlay.' : support.reason,
    );
  }

  /** The decal mesh. Its material carries the `uniforms` bag existing callers and tests read. */
  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /**
   * What to add to the cabin: the decal mesh alone, or — when the portal is
   * built — a group holding the decal and the portal's clipping group.
   */
  getRoot(): THREE.Object3D {
    return this.root;
  }

  /** The portal, when this cabin build has one. */
  getPortal(): WindshieldPortal | undefined {
    return this.portal;
  }

  private refreshVisibility(): void {
    // Keep the layer up while wiping so the clear arc is visible even if
    // WeatherPanel rain is at zero (blades alone are easy to miss).
    const wet =
      this.wipersActive || this.lastRain > 0.02 || this.lastCondensation > 0.04;
    const portalLive = this.portal?.isLive() === true;
    this.mesh.visible = wet && !portalLive;
    if (this.portal) this.portal.getMesh().visible = wet && portalLive;
  }

  /**
   * Rain as either layer sees it: the actual rain, or — wiping dry glass — a light
   * mist seed so the blades have something to clear. One rule for both layers.
   */
  private effectiveRain(): number {
    return this.wipersActive && this.lastRain < DRY_RAIN ? WIPING_MIST_RAIN : this.lastRain;
  }

  private pushPortalWeather(): void {
    this.portal?.setWeather(this.effectiveRain(), this.lastCondensation);
  }

  setWeather(rainNorm: number, fogNorm: number, humidity = 0): void {
    const u = this.material.uniforms;
    this.lastRain = Math.max(0, Math.min(1, rainNorm));
    this.lastCondensation = Math.max(
      0,
      Math.min(1, fogNorm * 0.65 + humidity * 0.35 + rainNorm * 0.15),
    );
    u.condensation.value = this.lastCondensation;
    // While wiping with a dry windshield, seed a light mist so the clear path reads.
    u.rainIntensity.value = this.effectiveRain();
    this.pushPortalWeather();
    this.refreshVisibility();
  }

  setWipersActive(active: boolean, phase: number): void {
    const u = this.material.uniforms;
    this.wipersActive = active;
    u.wiperActive.value = active;
    u.wiperPhase.value = phase;
    u.rainIntensity.value = this.effectiveRain();
    this.portal?.setWipers(active, phase);
    this.pushPortalWeather();
    this.refreshVisibility();
  }

  /**
   * Advance rain-streak time only. Wiper phase is owned by
   * CarInteriorAnimator — do not free-run it here or the clear arc
   * desyncs from the blade mesh.
   *
   * With a portal, this is also where the road's HDR frame is bound for this
   * cabin frame (before `render()`) and where the wet mask steps.
   */
  update(deltaTime: number): void {
    const u = this.material.uniforms;
    u.time.value += deltaTime;
    if (this.portal) {
      const state = this.portal.update(deltaTime);
      this.refreshVisibility();
      this.publishPortal(state, state.reason);
    }
  }

  private publishPortal(state: PortalFrameState, reason: string | undefined): void {
    const held = state.live ? state.held : false;
    const format = state.live ? state.format : undefined;
    const why = state.live ? undefined : reason;
    const last = this.published;
    if (
      last &&
      last.live === state.live &&
      last.held === held &&
      last.format === format &&
      last.reason === why
    ) {
      return;
    }
    this.published = { live: state.live, held, format, reason: why };
    publishCabinPortalState({
      active: state.live,
      reason: why,
      clipDistances: this.support.clipDistances,
      frameFormat: format,
      held: state.live ? state.held : undefined,
    });
  }

  dispose(): void {
    this.portal?.dispose();
    this.portal = undefined;
    // Detach too: `setupWindowWeatherOverlay` builds a fresh overlay on a hero
    // cabin swap, and a disposed layer left in the scene would still be drawn.
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
