/**
 * Effects module - Visual and audio effects for the car experience
 */

export {
  WindAudio,
  getWindAudio,
  initWindAudio,
  disposeWindAudio,
} from './WindAudio';
export type { WindAudioConfig } from './WindAudio';

export {
  UVLightEffect,
  EquipmentGlowEffect,
  EmergencyLightEffect,
  TaskLightEffect,
  LightingEffectsManager,
  DEFAULT_LIGHTING_CONFIG,
} from './LightingEffects';
export type { LightingEffectConfig } from './LightingEffects';
