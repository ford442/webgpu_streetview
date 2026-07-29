/**
 * Config resolution for the Supabase project used purely as a signaling
 * relay for Shared Exploration Sessions (room-code WebRTC handshake).
 * Mirrors the precedence used by src/app/mapsKeyUtils.ts: a build-time env
 * var wins, falling back to the runtime value injected by public/config.js.
 */

declare global {
  interface Window {
    /** Runtime Supabase project URL injected by public/config.js. */
    SUPABASE_URL?: string;
    /** Runtime Supabase anon/publishable key injected by public/config.js. */
    SUPABASE_ANON_KEY?: string;
  }
}

export const PLACEHOLDER_SUPABASE_PATTERNS: RegExp[] = [
  /^your[_-]?supabase[_-]?(url|(anon[_-]?)?key)?$/i,
  /^placeholder/i,
  /^<.*>$/,
  /replace/i,
];

export function normalizeSupabaseValue(value: string | undefined): string {
  const trimmed = value?.trim() || '';
  return PLACEHOLDER_SUPABASE_PATTERNS.some((re) => re.test(trimmed)) ? '' : trimmed;
}

export function getConfiguredSupabaseUrlFromEnv(
  buildTimeValue: string | undefined,
  runtimeValue: string | undefined,
): string {
  return normalizeSupabaseValue(buildTimeValue) || normalizeSupabaseValue(runtimeValue);
}

export function getConfiguredSupabaseAnonKeyFromEnv(
  buildTimeValue: string | undefined,
  runtimeValue: string | undefined,
): string {
  return normalizeSupabaseValue(buildTimeValue) || normalizeSupabaseValue(runtimeValue);
}

export function getConfiguredSupabaseUrl(): string {
  // Vite replaces process.env.* at build time (see vite.config.ts define shim).
  const buildTimeValue = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  return getConfiguredSupabaseUrlFromEnv(
    buildTimeValue,
    typeof window !== 'undefined' ? window.SUPABASE_URL : undefined,
  );
}

export function getConfiguredSupabaseAnonKey(): string {
  const buildTimeValue = process.env.VITE_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
  return getConfiguredSupabaseAnonKeyFromEnv(
    buildTimeValue,
    typeof window !== 'undefined' ? window.SUPABASE_ANON_KEY : undefined,
  );
}

/** Whether both URL + key are configured, i.e. room-code signaling can be attempted. */
export function isSignalingConfigured(): boolean {
  return Boolean(getConfiguredSupabaseUrl() && getConfiguredSupabaseAnonKey());
}
