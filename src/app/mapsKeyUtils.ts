export const MAPS_KEY_DEPLOY_SENTINEL = '__RUNTIME_MAPS_KEY_SENTINEL__';

export const PLACEHOLDER_MAPS_KEY_PATTERNS: RegExp[] = [
  /^your[_-]?(google[_-]?)?maps[_-]?api[_-]?key[_-]?(here)?$/i,
  /^YOUR_MAPS_API_KEY$/,
  /^__RUNTIME_MAPS_KEY_SENTINEL__$/,
  /^placeholder/i,
  /^<.*>$/,
  /replace/i,
];

export function normalizeMapsKey(value: string | undefined): string {
  const trimmed = value?.trim() || '';
  return PLACEHOLDER_MAPS_KEY_PATTERNS.some(re => re.test(trimmed)) ? '' : trimmed;
}

export function getConfiguredMapsKey(): string {
  return getConfiguredMapsKeyFromEnv(
    process.env.REACT_APP_MAPS_API_KEY,
    MAPS_KEY_DEPLOY_SENTINEL,
    typeof window !== 'undefined' ? window.MAPS_API_KEY : undefined,
  );
}

// Keep window.MAPS_API_KEY access explicit for bundlers / tests
export function getConfiguredMapsKeyFromEnv(
  reactAppKey: string | undefined,
  deploySentinel: string,
  runtimeKey: string | undefined,
): string {
  return (
    normalizeMapsKey(reactAppKey) ||
    normalizeMapsKey(deploySentinel) ||
    normalizeMapsKey(runtimeKey)
  );
}

export const INITIAL_MAPS_KEY = getConfiguredMapsKey();

export function warnIfMissingInitialMapsKey(): void {
  if (!INITIAL_MAPS_KEY) {
    console.warn(
      '[WebGPU StreetView] No Maps API key found at initial eval. ' +
        'Set REACT_APP_MAPS_API_KEY in .env.local and rebuild, or deploy with ' +
        'MAPS_API_KEY=... python deploy.py to bake the key into the bundle (go.1ink.us style).',
    );
  }
}
