import {
  normalizeMapsKey,
  getConfiguredMapsKeyFromEnv,
  MAPS_KEY_DEPLOY_SENTINEL,
  PLACEHOLDER_MAPS_KEY_PATTERNS,
} from './mapsKeyUtils';

describe('mapsKeyUtils', () => {
  describe('normalizeMapsKey', () => {
    it('returns empty string for undefined and blank input', () => {
      expect(normalizeMapsKey(undefined)).toBe('');
      expect(normalizeMapsKey('   ')).toBe('');
    });

    it('rejects known placeholder patterns', () => {
      for (const pattern of [
        'YOUR_MAPS_API_KEY',
        '__RUNTIME_MAPS_KEY_SENTINEL__',
        'your-google-maps-api-key-here',
        'placeholder-key',
        '<insert-key>',
        'replace-me',
      ]) {
        expect(normalizeMapsKey(pattern)).toBe('');
      }
    });

    it('accepts a real-looking key', () => {
      expect(normalizeMapsKey(' AIzaSyRealKey123 ')).toBe('AIzaSyRealKey123');
    });

    it('exports placeholder regex list for deploy sentinel', () => {
      expect(PLACEHOLDER_MAPS_KEY_PATTERNS.some((re) => re.test(MAPS_KEY_DEPLOY_SENTINEL))).toBe(true);
    });
  });

  describe('getConfiguredMapsKeyFromEnv', () => {
    it('prefers REACT_APP key over deploy sentinel and runtime', () => {
      expect(
        getConfiguredMapsKeyFromEnv('react-key', MAPS_KEY_DEPLOY_SENTINEL, 'runtime-key'),
      ).toBe('react-key');
    });

    it('falls through to deploy sentinel when env is placeholder', () => {
      expect(
        getConfiguredMapsKeyFromEnv('YOUR_MAPS_API_KEY', 'baked-deploy-key', 'runtime-key'),
      ).toBe('baked-deploy-key');
    });

    it('falls through to runtime key when env and sentinel are placeholders', () => {
      expect(
        getConfiguredMapsKeyFromEnv('', MAPS_KEY_DEPLOY_SENTINEL, 'late-runtime-key'),
      ).toBe('late-runtime-key');
    });

    it('returns empty when all sources are missing or placeholders', () => {
      expect(getConfiguredMapsKeyFromEnv(undefined, MAPS_KEY_DEPLOY_SENTINEL, '')).toBe('');
    });
  });
});
