/**
 * Named glTF sockets the hero sedan cabin must expose so the procedural
 * animator, gauges, weather overlay, and rearview feed keep working.
 */
export const GLTF_INTERIOR_SOCKETS = [
  'SteeringWheel',
  'WiperL',
  'WiperR',
  'SpeedoNeedle',
  'TachoNeedle',
  'RearviewGlass',
  'SideMirrorL',
  'SideMirrorR',
  'Windshield',
] as const;

export type GltfInteriorSocket = (typeof GLTF_INTERIOR_SOCKETS)[number];

export const GLTF_INTERIOR_ASSET = 'models/sedan-cabin.glb';
export const GLTF_INTERIOR_STORAGE_KEY = 'webgpu_streetview_gltf_interior';
