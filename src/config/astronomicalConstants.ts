/**
 * Astronomical Constants
 * 
 * Scientifically validated astronomical and color science constants
 * for use in lighting calculations, celestial position computation,
 * and atmospheric rendering.
 * 
 * Sources: Wolfram Alpha, NOAA Solar Calculator, IAU standards,
 *          CIE colorimetric standards
 */

// ============================================================================
// SOLAR CONSTANTS
// ============================================================================

/**
 * Angular diameter of the sun as seen from Earth (~0.53° or 32 arcminutes)
 * @units radians
 */
export const SUN_ANGULAR_DIAMETER = 0.0093;

/**
 * Atmospheric refraction at the horizon (~0.50° at standard conditions)
 * Causes the sun to appear higher than its true geometric position
 * @units radians
 */
export const ATMOSPHERIC_REFRACTION = 0.0087;

/**
 * Solar elevation angle when the upper limb touches the horizon
 * (-0.833° = sun center position at standard sunset)
 * @units radians
 */
export const SUNSET_UPPER_LIMB = -0.0145;

/**
 * Golden hour begins when sun is +6° above horizon
 * @units radians
 */
export const GOLDEN_HOUR_START = 0.1047;

/**
 * Civil twilight ends when sun is -6° below horizon
 * @units radians
 */
export const CIVIL_TWILIGHT_END = -0.1047;

/**
 * Nautical twilight ends when sun is -12° below horizon
 * @units radians
 */
export const NAUTICAL_TWILIGHT_END = -0.2094;

/**
 * Astronomical twilight ends when sun is -18° below horizon
 * @units radians
 */
export const ASTRONOMICAL_TWILIGHT_END = -0.3142;

/**
 * Duration of a mean solar day
 * @units minutes
 */
export const SOLAR_DAY_MINUTES = 1440;

/**
 * Duration of a sidereal day (Earth's rotation relative to stars)
 * @units minutes (23h 56m 4s)
 */
export const SIDEREAL_DAY_MINUTES = 1436;

/**
 * Apparent motion of the sun across the sky
 * @units degrees per minute (360° / 1440 min)
 */
export const SUN_APPARENT_MOTION_PER_MINUTE = 0.25;

// ============================================================================
// LUNAR CONSTANTS
// ============================================================================

/**
 * Sidereal month - moon's orbital period relative to stars
 * @units days
 */
export const SIDEREAL_MONTH = 27.32158;

/**
 * Synodic month - time between new moons (lunar phases)
 * @units days
 */
export const SYNODIC_MONTH = 29.53059;

/**
 * Angular diameter of the moon as seen from Earth (~30 arcminutes or 0.5°)
 * @units radians
 */
export const MOON_ANGULAR_DIAMETER = 0.0087;

/**
 * Apparent magnitude of the full moon
 * @units magnitude (logarithmic brightness scale)
 */
export const FULL_MOON_APPARENT_MAGNITUDE = -12.7;

/**
 * Typical maximum illuminance from full moon
 * @units lux
 */
export const FULL_MOON_ILLUMINANCE_LUX = 0.27;

/**
 * Lunar surface albedo (reflectivity)
 * Moon reflects ~12% of incident sunlight
 * @units ratio (0-1)
 */
export const MOON_ALBEDO = 0.12;

/**
 * Earth's average albedo (Bond albedo)
 * Earth reflects ~30% of incident sunlight
 * @units ratio (0-1)
 */
export const EARTH_ALBEDO = 0.30;

/**
 * Ratio of earthshine to moonshine on the moon
 * Earthshine is approximately 1/40th as bright as moonlight
 * @units ratio
 */
export const EARTHSHINE_RATIO = 1 / 40;

// ============================================================================
// COLOR SCIENCE CONSTANTS
// ============================================================================

/**
 * Luma coefficients for Rec.709 (HD video, sRGB)
 * Used for computing perceived brightness
 */
export const LUMA_REC709 = {
    r: 0.2126,
    g: 0.7152,
    b: 0.0722
} as const;

/**
 * Luma coefficients for Rec.601 (SD video)
 * Legacy standard for standard definition video
 */
export const LUMA_REC601 = {
    r: 0.299,
    g: 0.587,
    b: 0.114
} as const;

/**
 * Color temperature of candlelight
 * @units Kelvin
 */
export const COLOR_TEMP_CANDLELIGHT = 1850;

/**
 * Color temperature at sunrise/sunset
 * @units Kelvin
 */
export const COLOR_TEMP_SUNRISE = 2000;

/**
 * Color temperature during golden hour
 * @units Kelvin
 */
export const COLOR_TEMP_GOLDEN_HOUR = 3500;

/**
 * Color temperature of direct daylight (noon sun)
 * @units Kelvin
 */
export const COLOR_TEMP_DAYLIGHT = 5500;

/**
 * Color temperature of overcast daylight
 * @units Kelvin
 */
export const COLOR_TEMP_OVERCAST = 6500;

/**
 * Color temperature of open shade
 * @units Kelvin
 */
export const COLOR_TEMP_SHADE = 7500;

/**
 * Color temperature during blue hour
 * @units Kelvin
 */
export const COLOR_TEMP_BLUE_HOUR = 9000;

/**
 * Scientifically derived RGB color values for sunset phases
 * Based on blackbody radiation at corresponding color temperatures
 */
export const SUNSET_COLORS = {
    /** Golden hour (~3500K) - warm yellow-orange */
    goldenHour: { r: 1.00, g: 0.72, b: 0.35 },
    
    /** Sunset orange (~2500K) - deep orange */
    sunsetOrange: { r: 1.00, g: 0.55, b: 0.18 },
    
    /** Deep sunset (~2000K) - red-orange */
    deepSunset: { r: 0.95, g: 0.35, b: 0.12 }
} as const;

// ============================================================================
// SPHERICAL GEOMETRY CONSTANTS
// ============================================================================

/**
 * Earth's mean radius (average of equatorial and polar)
 * @units kilometers
 */
export const EARTH_MEAN_RADIUS_KM = 6371;

/**
 * Earth's equatorial radius (semi-major axis)
 * @units kilometers
 */
export const EARTH_EQUATORIAL_RADIUS_KM = 6378;

/**
 * Earth's polar radius (semi-minor axis)
 * @units kilometers
 */
export const EARTH_POLAR_RADIUS_KM = 6357;

/**
 * Conversion factor: kilometers to miles
 * @units miles per kilometer
 */
export const KM_TO_MILES = 0.621371;

/**
 * Conversion factor: kilometers to nautical miles
 * @units nautical miles per kilometer
 */
export const KM_TO_NAUTICAL_MILES = 0.539957;

// ============================================================================
// DERIVED CONSTANTS (computed from base values)
// ============================================================================

/**
 * Earth's flattening factor
 * (equatorial radius - polar radius) / equatorial radius
 */
export const EARTH_FLATTENING = (EARTH_EQUATORIAL_RADIUS_KM - EARTH_POLAR_RADIUS_KM) / EARTH_EQUATORIAL_RADIUS_KM;

/**
 * Earth's eccentricity squared (for geodetic calculations)
 */
export const EARTH_ECCENTRICITY_SQUARED = EARTH_FLATTENING * (2 - EARTH_FLATTENING);

/**
 * Ratio of sidereal day to solar day
 */
export const SIDEREAL_SOLAR_DAY_RATIO = SIDEREAL_DAY_MINUTES / SOLAR_DAY_MINUTES;

/**
 * Sun's apparent angular motion per second
 * @units degrees per second
 */
export const SUN_APPARENT_MOTION_PER_SECOND = SUN_APPARENT_MOTION_PER_MINUTE / 60;

/**
 * Sun's apparent angular motion per hour
 * @units degrees per hour
 */
export const SUN_APPARENT_MOTION_PER_HOUR = SUN_APPARENT_MOTION_PER_MINUTE * 60;

// ============================================================================
// TYPE EXPORTS (for TypeScript consumers)
// ============================================================================

/** RGB color triplet in floating point (0-1 range) */
export interface RGBColor {
    r: number;
    g: number;
    b: number;
}

/** Luma coefficient set for color space */
export interface LumaCoefficients {
    r: number;
    g: number;
    b: number;
}

/** Sunset color palette */
export type SunsetPhase = keyof typeof SUNSET_COLORS;
