/**
 * Dashboard Theme – CSS custom-property definitions for day / night / neon modes.
 *
 * Inject the returned object into the style prop of the dashboard root;
 * all descendant CSS-module classes automatically pick up the variables.
 */

export interface Theme {
  '--bg-primary': string;
  '--bg-glass': string;
  '--ambient-glow': string;
  '--accent': string;
  '--accent-hover': string;
  '--accent-active': string;
  '--text-primary': string;
  '--text-muted': string;
  '--border-color': string;
  '--border-hover': string;
  '--night-intensity': string;
}

export const lightTheme: Theme = {
  '--bg-primary': 'rgba(0,12,20,0.55)',
  '--bg-glass': 'rgba(0,12,20,0.4)',
  '--ambient-glow': 'rgba(0,212,255,0.45)',
  '--accent': '#00D4FF',
  '--accent-hover': 'rgba(0,212,255,0.22)',
  '--accent-active': 'rgba(0,212,255,0.35)',
  '--text-primary': '#fff',
  '--text-muted': 'rgba(255,255,255,0.6)',
  '--border-color': 'rgba(255,255,255,0.1)',
  '--border-hover': 'rgba(0,212,255,0.3)',
  '--night-intensity': '0',
};

export const darkTheme: Theme = {
  '--bg-primary': 'rgba(0,0,0,0.85)',
  '--bg-glass': 'rgba(0,0,0,0.6)',
  '--ambient-glow': 'rgba(0,212,255,0.65)',
  '--accent': '#00D4FF',
  '--accent-hover': 'rgba(0,212,255,0.3)',
  '--accent-active': 'rgba(0,212,255,0.45)',
  '--text-primary': '#fff',
  '--text-muted': 'rgba(255,255,255,0.5)',
  '--border-color': 'rgba(255,255,255,0.1)',
  '--border-hover': 'rgba(0,212,255,0.3)',
  '--night-intensity': '0',
};

export const neonTheme: Theme = {
  '--bg-primary': 'rgba(10,0,20,0.75)',
  '--bg-glass': 'rgba(10,0,20,0.55)',
  '--ambient-glow': 'rgba(212,0,255,0.55)',
  '--accent': '#D400FF',
  '--accent-hover': 'rgba(212,0,255,0.3)',
  '--accent-active': 'rgba(212,0,255,0.45)',
  '--text-primary': '#fff',
  '--text-muted': 'rgba(255,255,255,0.5)',
  '--border-color': 'rgba(255,255,255,0.1)',
  '--border-hover': 'rgba(212,0,255,0.3)',
  '--night-intensity': '0',
};

/**
 * Merge a base theme with runtime overrides (ambient light colour, night intensity).
 */
export function applyTheme(
  base: Theme,
  overrides: {
    ambientLightColor?: string;
    nightIntensity?: number;
  }
): React.CSSProperties {
  return {
    ...base,
    '--ambient-glow': overrides.ambientLightColor ?? base['--ambient-glow'],
    '--night-intensity': (overrides.nightIntensity ?? 0).toString(),
  } as React.CSSProperties;
}
