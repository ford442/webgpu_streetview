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
  '--bg-primary': 'rgba(8,14,12,0.55)',
  '--bg-glass': 'rgba(8,14,12,0.4)',
  '--ambient-glow': 'rgba(70,210,130,0.28)',
  '--accent': '#4CAF50',
  '--accent-hover': 'rgba(76,175,80,0.22)',
  '--accent-active': 'rgba(76,175,80,0.35)',
  '--text-primary': '#fff',
  '--text-muted': 'rgba(255,255,255,0.6)',
  '--border-color': 'rgba(255,255,255,0.1)',
  '--border-hover': 'rgba(76,175,80,0.3)',
  '--night-intensity': '0',
};

export const darkTheme: Theme = {
  '--bg-primary': 'rgba(0,0,0,0.85)',
  '--bg-glass': 'rgba(0,0,0,0.6)',
  '--ambient-glow': 'rgba(70,210,130,0.22)',
  '--accent': '#4CAF50',
  '--accent-hover': 'rgba(76,175,80,0.3)',
  '--accent-active': 'rgba(76,175,80,0.45)',
  '--text-primary': '#fff',
  '--text-muted': 'rgba(255,255,255,0.5)',
  '--border-color': 'rgba(255,255,255,0.1)',
  '--border-hover': 'rgba(76,175,80,0.3)',
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
  const glow = overrides.ambientLightColor ?? base['--ambient-glow'];
  return {
    ...base,
    '--ambient-glow': glow,
    '--night-intensity': (overrides.nightIntensity ?? 0).toString(),
  } as React.CSSProperties;
}

/**
 * HUD glow that matches the 3D cluster colour temperature per vehicle.
 * Day (night ≈ 0) keeps the environment fallback so golden-hour/sunset tints
 * still reach the glass; night replaces the old cyan wash.
 */
export function clusterAmbientGlow(
  vehicle: 'sedan' | 'convertible' | 'science-lab' | 'limousine' | 'cortianics' | undefined,
  nightIntensity: number,
  dayFallback: string,
): string {
  if (nightIntensity < 0.08) return dayFallback;
  const a = Math.min(0.36, 0.1 + nightIntensity * 0.2).toFixed(3);
  switch (vehicle) {
    case 'science-lab':
      return `rgba(0, 180, 200, ${a})`;
    case 'convertible':
      return `rgba(255, 110, 64, ${a})`;
    case 'limousine':
      return `rgba(212, 176, 96, ${a})`;
    case 'cortianics':
      return `rgba(220, 32, 28, ${a})`;
    default:
      return `rgba(70, 210, 130, ${a})`;
  }
}
