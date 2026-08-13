/**
 * Car Variants - Different vehicle interior configurations
 */

// Convertible Mode
export { ConvertibleMode, ConvertibleInterior, SportDashboard, SportSeats } from './ConvertibleMode';
export { WindParticleSystem } from './convertible/WindParticleSystem';
export type { ConvertibleState } from './ConvertibleMode';

// Limousine Mode
export { LimousineMode, initLimousineMode } from './LimousineMode';
export type { LimoState } from './limousine/limoAtmosphere';
export { defaultLimoState } from './limousine/limoAtmosphere';

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
