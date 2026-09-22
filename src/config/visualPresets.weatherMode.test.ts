import { PRESETS, QualityLevel } from './visualPresets';

/**
 * The preset weather defaults are a shipped policy, not an implementation
 * detail: compute weather raises the adapter limit floor and switches on GPU
 * particles, so a preset moving between the two paths is a visible change.
 */
describe('preset weather post-process defaults', () => {
  it('keeps Low and Medium on the fragment path', () => {
    for (const quality of ['low', 'medium'] as const) {
      expect(PRESETS[quality].weatherPostProcessMode).toBe('fragment');
    }
  });

  it('defaults High and Ultra to compute weather', () => {
    for (const quality of ['high', 'ultra'] as const) {
      expect(PRESETS[quality].weatherPostProcessMode).toBe('compute');
    }
  });

  it('only ever declares one of the two known modes', () => {
    for (const quality of Object.keys(PRESETS) as QualityLevel[]) {
      expect(['fragment', 'compute']).toContain(PRESETS[quality].weatherPostProcessMode);
    }
  });
});
