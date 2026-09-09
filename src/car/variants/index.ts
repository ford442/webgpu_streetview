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
// Science Lab Mode
export {
    ScienceLabInterior,
    initScienceLabMode,
    initScienceLabModeSystem,
    toggleScienceLabMode,
    updateScienceLabMode,
    toggleUVLight,
    toggleLabEquipment,
    getLabState,
    disposeScienceLabMode,
} from './ScienceLabMode';
export type { LabState, ScienceLabModeState } from './ScienceLabMode';

// Cortianics GT
export { CORTIANICS_ACCENT, CORTIANICS_NIGHT_STRIP, CORTIANICS_REFERENCE } from './CortianicsMode';
