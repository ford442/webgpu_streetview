import { describe, expect, it } from 'vitest';
import { clusterAmbientGlow } from './theme';

describe('clusterAmbientGlow', () => {
  it('passes through the day fallback when night is off', () => {
    expect(clusterAmbientGlow('sedan', 0, 'rgba(255,255,255,0)')).toBe('rgba(255,255,255,0)');
  });

  it('uses instrument green for sedan at night, not cyan', () => {
    const glow = clusterAmbientGlow('sedan', 1, 'rgba(20,40,100,0.25)');
    expect(glow.startsWith('rgba(70, 210, 130,')).toBe(true);
    expect(glow).not.toContain('40, 100');
  });

  it('follows vehicle accent temperature', () => {
    expect(clusterAmbientGlow('science-lab', 1, 'x')).toContain('0, 180, 200');
    expect(clusterAmbientGlow('convertible', 1, 'x')).toContain('255, 110, 64');
    expect(clusterAmbientGlow('limousine', 1, 'x')).toContain('212, 176, 96');
    expect(clusterAmbientGlow('cortianics', 1, 'x')).toContain('220, 32, 28');
  });
});
