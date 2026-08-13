/**
 * Type-only exports for the Cesium JS API surface used by GlobeView and helpers.
 * Runtime `Cesium` is loaded from CDN — see `src/types/cesium.d.ts` for the global.
 */

export interface CesiumCartesian2 {
  x: number;
  y: number;
}

export interface CesiumCartesian3 {
  x: number;
  y: number;
  z: number;
}

export interface CesiumEntity {
  position?: CesiumCartesian3 | { setValue?: (v: CesiumCartesian3) => void };
  description?: unknown;
}

export interface CesiumEntityCollection {
  add(options: Record<string, unknown>): CesiumEntity;
  remove(entity: CesiumEntity): boolean;
}

export type CesiumImageryLayer = object;

export type CesiumTerrainProvider = object;

export interface CesiumViewerOptions {
  animation?: boolean;
  baseLayerPicker?: boolean;
  fullscreenButton?: boolean;
  geocoder?: boolean;
  homeButton?: boolean;
  infoBox?: boolean;
  sceneModePicker?: boolean;
  selectionIndicator?: boolean;
  timeline?: boolean;
  navigationHelpButton?: boolean;
  navigationInstructionsInitiallyVisible?: boolean;
  vrButton?: boolean;
  skyAtmosphere?: unknown;
  terrainProvider?: CesiumTerrainProvider;
  baseLayer?: CesiumImageryLayer | false;
}

export interface CesiumCamera {
  setView(options: {
    destination: CesiumCartesian3;
    orientation?: { heading?: number; pitch?: number; roll?: number };
  }): void;
  flyTo(options: {
    destination: CesiumCartesian3;
    orientation?: { heading?: number; pitch?: number; roll?: number };
    duration?: number;
    complete?: () => void;
  }): void;
  pickEllipsoid(windowPosition: CesiumCartesian2, ellipsoid: unknown): CesiumCartesian3 | undefined;
}

export interface CesiumScene {
  canvas: HTMLCanvasElement;
  globe: { ellipsoid: unknown };
  pick(windowPosition: CesiumCartesian2): { id?: CesiumEntity & { properties?: CesiumPropertyBag } } | undefined;
}

export interface CesiumPropertyBag {
  bookmarkLat?: { getValue(): number };
  bookmarkLng?: { getValue(): number };
}

export interface CesiumViewer {
  camera: CesiumCamera;
  scene: CesiumScene;
  entities: CesiumEntityCollection;
  isDestroyed(): boolean;
  destroy(): void;
}

export interface CesiumScreenSpaceEventHandler {
  setInputAction(
    action: (event: { position: CesiumCartesian2 }) => void,
    type: number,
    modifier?: number,
  ): void;
  destroy(): void;
}

export interface CesiumNamespace {
  Viewer: new (container: HTMLElement, options?: CesiumViewerOptions) => CesiumViewer;
  ScreenSpaceEventHandler: new (canvas: HTMLCanvasElement) => CesiumScreenSpaceEventHandler;
  ScreenSpaceEventType: {
    LEFT_CLICK: number;
    LEFT_DOUBLE_CLICK: number;
  };
  KeyboardEventModifier: {
    SHIFT: number;
  };
  Cartesian2: new (x?: number, y?: number) => CesiumCartesian2;
  Cartesian3: {
    fromDegrees(longitude: number, latitude: number, height?: number): CesiumCartesian3;
  };
  Cartographic: {
    fromCartesian(cartesian: CesiumCartesian3): { latitude: number; longitude: number };
  };
  Color: {
    fromCssColorString(color: string): unknown;
    BLACK: unknown;
    WHITE: unknown;
  };
  Math: {
    toRadians(degrees: number): number;
    toDegrees(radians: number): number;
  };
  VerticalOrigin: { CENTER: number; BOTTOM: number };
  LabelStyle: { FILL_AND_OUTLINE: number };
  Entity: new (options: Record<string, unknown>) => CesiumEntity;
  EllipsoidTerrainProvider: new () => CesiumTerrainProvider;
  SkyAtmosphere: new () => unknown;
  defined(value: unknown): boolean;
  createWorldTerrainAsync(): Promise<CesiumTerrainProvider>;
  Ion: { defaultAccessToken: string };
  ImageryLayer: {
    new (provider: unknown): CesiumImageryLayer;
    fromWorldImagery(): CesiumImageryLayer;
  };
  UrlTemplateImageryProvider: new (options: Record<string, unknown>) => unknown;
  ConstantProperty: new (value: unknown) => unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var Cesium: CesiumNamespace;
}

export {};
