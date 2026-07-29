/** 3D position in driver-cabin local metres. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Instrument-cluster layout shared by gauges + dashboard bezel. */
export interface GaugeLayoutConfig {
  speed: Vec3;
  tacho: Vec3;
  fuel: Vec3;
  temp: Vec3;
  dialRadius: number;
  needleLength: number;
  coverRadius: number;
  hubRadius: number;
  needleZ: number;
  hubZ: number;
  coverZ: number;
}

export interface SteeringWheelConfig {
  position: Vec3;
  columnPosition: Vec3;
  rimRadius: number;
  /** Wheel plane tilt (radians, rotation.x on the rim). */
  tilt: number;
}

export interface CameraFovConfig {
  /** Vertical FOV at Street View zoom = 1 (degrees). */
  base: number;
  /** Narrowest FOV at max zoom-in (degrees). */
  min: number;
  /** Widest FOV at max zoom-out (degrees). */
  max: number;
}

export interface GaugeLayoutOverrides {
  speed?: Partial<Vec3>;
  tacho?: Partial<Vec3>;
  fuel?: Partial<Vec3>;
  temp?: Partial<Vec3>;
  dialRadius?: number;
  needleLength?: number;
  coverRadius?: number;
  hubRadius?: number;
  needleZ?: number;
  hubZ?: number;
  coverZ?: number;
}

export interface SteeringWheelOverrides {
  position?: Partial<Vec3>;
  columnPosition?: Partial<Vec3>;
  rimRadius?: number;
  tilt?: number;
}

/** Sedan defaults — lowered cluster + smaller wheel to clear lower FOV. */
export const DEFAULT_GAUGE_LAYOUT: GaugeLayoutConfig = {
  speed: { x: -0.48, y: 0.70, z: -0.84 },
  tacho: { x: -0.18, y: 0.70, z: -0.84 },
  fuel: { x: -0.42, y: 0.58, z: -0.84 },
  temp: { x: -0.24, y: 0.58, z: -0.84 },
  dialRadius: 0.085,
  needleLength: 0.066,
  coverRadius: 0.09,
  hubRadius: 0.007,
  needleZ: 0.006,
  hubZ: 0.009,
  coverZ: 0.017,
};

export const DEFAULT_STEERING_WHEEL: SteeringWheelConfig = {
  position: { x: -0.35, y: 0.86, z: -0.52 },
  columnPosition: { x: -0.35, y: 0.70, z: -0.62 },
  rimRadius: 0.15,
  tilt: Math.PI * 0.35,
};

export const DEFAULT_CAMERA_FOV: CameraFovConfig = {
  base: 58,
  min: 30,
  max: 88,
};

export function resolveGaugeLayout(config: { gaugeLayout?: GaugeLayoutOverrides }): GaugeLayoutConfig {
  const partial = config.gaugeLayout;
  if (!partial) return { ...DEFAULT_GAUGE_LAYOUT };
  return {
    ...DEFAULT_GAUGE_LAYOUT,
    ...partial,
    speed: { ...DEFAULT_GAUGE_LAYOUT.speed, ...partial.speed },
    tacho: { ...DEFAULT_GAUGE_LAYOUT.tacho, ...partial.tacho },
    fuel: { ...DEFAULT_GAUGE_LAYOUT.fuel, ...partial.fuel },
    temp: { ...DEFAULT_GAUGE_LAYOUT.temp, ...partial.temp },
  };
}

export function resolveSteeringWheel(config: { steeringWheel?: SteeringWheelOverrides }): SteeringWheelConfig {
  const partial = config.steeringWheel;
  if (!partial) return { ...DEFAULT_STEERING_WHEEL };
  return {
    ...DEFAULT_STEERING_WHEEL,
    ...partial,
    position: { ...DEFAULT_STEERING_WHEEL.position, ...partial.position },
    columnPosition: { ...DEFAULT_STEERING_WHEEL.columnPosition, ...partial.columnPosition },
  };
}

export function resolveCameraFov(config: { cameraFov: CameraFovConfig }): CameraFovConfig {
  return {
    base: config.cameraFov.base ?? DEFAULT_CAMERA_FOV.base,
    min: config.cameraFov.min ?? DEFAULT_CAMERA_FOV.min,
    max: config.cameraFov.max ?? DEFAULT_CAMERA_FOV.max,
  };
}

/** Map Street View zoom (0.5–3) to vertical camera FOV using per-vehicle endpoints. */
export function zoomToVerticalFov(zoom: number, fov: CameraFovConfig): number {
  const refZoom = 1;
  const minZoom = 0.5;
  const maxZoom = 3;
  const z = Math.max(minZoom, Math.min(maxZoom, zoom));
  if (z <= refZoom) {
    const t = (z - minZoom) / (refZoom - minZoom);
    return fov.max + t * (fov.base - fov.max);
  }
  const t = (z - refZoom) / (maxZoom - refZoom);
  return fov.base + t * (fov.min - fov.base);
}
