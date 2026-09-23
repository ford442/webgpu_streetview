import { describe, expect, it } from 'vitest';
import { formatRpm, getGearColor } from '../Gauges';

/**
 * Pure formatting helpers behind TelemetryChip — the DOM chip and the 3D
 * cluster both read from telemetryFeed's single snapshot (see
 * telemetryFeed.test.ts); this file pins how the chip renders that snapshot.
 */
describe('TelemetryChip formatting', () => {
  it('formats sub-1000 RPM as a plain rounded integer', () => {
    expect(formatRpm(0)).toBe('0');
    expect(formatRpm(847.4)).toBe('847');
    expect(formatRpm(999.6)).toBe('1000');
  });

  it('formats four-figure RPM with one decimal of thousands', () => {
    expect(formatRpm(1000)).toBe('1.0k');
    expect(formatRpm(2100)).toBe('2.1k');
    expect(formatRpm(6500)).toBe('6.5k');
  });

  it('rounds five-figure-and-up RPM to a whole thousand', () => {
    expect(formatRpm(10000)).toBe('10k');
    expect(formatRpm(12499)).toBe('12k');
  });

  it('maps each gear letter to a distinct color, case-insensitively', () => {
    expect(getGearColor('P')).toBe('#4CAF50');
    expect(getGearColor('r')).toBe('#FF3864');
    expect(getGearColor('N')).toBe('#FFC107');
    expect(getGearColor('d')).toBe('#4CAF50');
  });

  it('falls back to the drive color for an unrecognized gear label', () => {
    expect(getGearColor('2')).toBe('#4CAF50');
  });
});
