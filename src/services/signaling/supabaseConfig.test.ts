import {
  normalizeSupabaseValue,
  getConfiguredSupabaseUrlFromEnv,
  getConfiguredSupabaseAnonKeyFromEnv,
  PLACEHOLDER_SUPABASE_PATTERNS,
} from './supabaseConfig';

describe('supabaseConfig', () => {
  describe('normalizeSupabaseValue', () => {
    it('returns empty string for undefined and blank input', () => {
      expect(normalizeSupabaseValue(undefined)).toBe('');
      expect(normalizeSupabaseValue('   ')).toBe('');
    });

    it('rejects known placeholder patterns', () => {
      for (const pattern of ['YOUR_SUPABASE_URL', 'placeholder-key', '<insert-url>', 'replace-me']) {
        expect(normalizeSupabaseValue(pattern)).toBe('');
      }
    });

    it('accepts a real-looking value', () => {
      expect(normalizeSupabaseValue(' https://abc123.supabase.co ')).toBe('https://abc123.supabase.co');
    });

    it('exports a non-empty placeholder pattern list', () => {
      expect(PLACEHOLDER_SUPABASE_PATTERNS.length).toBeGreaterThan(0);
    });
  });

  describe('getConfiguredSupabaseUrlFromEnv / getConfiguredSupabaseAnonKeyFromEnv', () => {
    it('prefers the build-time value over the runtime value', () => {
      expect(getConfiguredSupabaseUrlFromEnv('build-url', 'runtime-url')).toBe('build-url');
      expect(getConfiguredSupabaseAnonKeyFromEnv('build-key', 'runtime-key')).toBe('build-key');
    });

    it('falls through to the runtime value when the build-time value is missing or a placeholder', () => {
      expect(getConfiguredSupabaseUrlFromEnv(undefined, 'runtime-url')).toBe('runtime-url');
      expect(getConfiguredSupabaseUrlFromEnv('placeholder', 'runtime-url')).toBe('runtime-url');
    });

    it('returns empty when both sources are missing or placeholders', () => {
      expect(getConfiguredSupabaseUrlFromEnv('', '')).toBe('');
      expect(getConfiguredSupabaseAnonKeyFromEnv(undefined, undefined)).toBe('');
    });
  });
});
