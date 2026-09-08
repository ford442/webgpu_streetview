import { describe, expect, it } from 'vitest';
import { applyTheme, clusterAmbientGlow, darkTheme } from './theme';

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
  });
});

describe('applyTheme accent override', () => {
  it('keeps dark glass and applies science-lab teal to --accent', () => {
    const style = applyTheme(darkTheme, { accent: '#00BCD4' }) as Record<string, string>;
    expect(style['--bg-glass']).toBe(darkTheme['--bg-glass']);
    expect(style['--accent']).toBe('#00BCD4');
    expect(style['--accent-hover']).toBe('rgba(0, 188, 212, 0.3)');
    expect(style['--accent-active']).toBe('rgba(0, 188, 212, 0.45)');
  });

  it('does not change accent when no override is passed', () => {
    const style = applyTheme(darkTheme, {}) as Record<string, string>;
    expect(style['--accent']).toBe(darkTheme['--accent']);
  });
});

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
  });
});
