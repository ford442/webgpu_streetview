/**
 * Car Variants - Different vehicle interior configurations
 */

// Convertible Mode
export { ConvertibleMode, ConvertibleInterior, SportDashboard, SportSeats } from './ConvertibleMode';
export { WindParticleSystem } from './convertible/WindParticleSystem';
export type { ConvertibleState } from './ConvertibleMode';

// Limousine atmosphere — scene plugin layered onto the shared cabin (see LimoAtmospherePlugin.ts doc comment)
export { LimoAtmosphere, defaultLimoState } from './limousine/LimoAtmospherePlugin';
export type { LimoState } from './limousine/LimoAtmospherePlugin';

// Science-lab atmosphere — scene plugin layered onto the shared cabin
export { ScienceLabAtmosphere } from './scienceLab/ScienceLabAtmosphere';
export type { LabState } from './scienceLab/ScienceLabAtmosphere';
