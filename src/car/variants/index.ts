/**
 * Car Variants - Different vehicle interior configurations
 */

// Convertible Mode
export { ConvertibleMode, WindParticleSystem, ConvertibleInterior, SportDashboard, SportSeats } from './ConvertibleMode';
export type { ConvertibleState } from './ConvertibleMode';

// Limousine Mode
export { LimousineMode, initLimousineMode } from './LimousineMode';
export type { LimoState } from './LimousineMode';
export { defaultLimoState } from './LimousineMode';

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
