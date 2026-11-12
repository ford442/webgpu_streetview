/** World-axis conventions shared by the road renderer and the cabin. */

/**
 * Particle fall direction in top-origin UV space (uv.y = 0 at top, 1 at bottom).
 * Negative Y velocity ⇒ flakes/streaks move downward on screen.
 * WebGPU fragCoord and the GLSL reference (which flips vUv.y) both use top-origin.
 */
export const WEATHER_FALL_Y_SIGN = -1 as const;
