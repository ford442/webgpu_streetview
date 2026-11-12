import { getZonedClock } from './localTime';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number =>
  Date.UTC(y, mo - 1, d, h, mi, s);

const fmt = (ms: number, zone: string | null): string => {
  const { hh, mm, ss } = getZonedClock(ms, zone);
  return `${hh}:${mm}:${ss}`;
};

describe('getZonedClock', () => {
  describe('Lisbon (Europe/Lisbon, EU DST: WET UTC+0 → WEST UTC+1)', () => {
    it('spring forward 2026-03-29 01:00 UTC: 00:59:59 → 02:00:00', () => {
      expect(fmt(utc(2026, 3, 29, 0, 59, 59), 'Europe/Lisbon')).toBe('00:59:59');
      expect(fmt(utc(2026, 3, 29, 1, 0, 0), 'Europe/Lisbon')).toBe('02:00:00');
    });

    it('fall back 2026-10-25 01:00 UTC: 01:59:59 (WEST) → 01:00:00 (WET)', () => {
      expect(fmt(utc(2026, 10, 25, 0, 59, 59), 'Europe/Lisbon')).toBe('01:59:59');
      expect(fmt(utc(2026, 10, 25, 1, 0, 0), 'Europe/Lisbon')).toBe('01:00:00');
    });
  });

  describe('Tokyo (Asia/Tokyo, no DST: always UTC+9)', () => {
    it('applies the same +9h on both sides of the EU switch instants', () => {
      expect(fmt(utc(2026, 3, 29, 0, 59, 59), 'Asia/Tokyo')).toBe('09:59:59');
      expect(fmt(utc(2026, 3, 29, 1, 0, 0), 'Asia/Tokyo')).toBe('10:00:00');
      expect(fmt(utc(2026, 10, 25, 0, 59, 59), 'Asia/Tokyo')).toBe('09:59:59');
      expect(fmt(utc(2026, 10, 25, 1, 0, 0), 'Asia/Tokyo')).toBe('10:00:00');
    });

    it('prints local midnight as 00, never 24', () => {
      expect(fmt(utc(2026, 3, 28, 15, 0, 0), 'Asia/Tokyo')).toBe('00:00:00');
      expect(fmt(utc(2026, 3, 28, 15, 0, 1), 'Asia/Tokyo')).toBe('00:00:01');
    });
  });

  it('handles half-hour offsets (Asia/Kolkata, epoch 0 → 05:30:00)', () => {
    expect(fmt(0, 'Asia/Kolkata')).toBe('05:30:00');
  });

  describe('system-time fallback', () => {
    const system = (ms: number): string => {
      const d = new Date(ms);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };

    it('null zone → the viewer’s local time', () => {
      const ms = utc(2026, 6, 15, 12, 34, 56);
      expect(fmt(ms, null)).toBe(system(ms));
    });

    it('an unknown zone name → the viewer’s local time, without throwing', () => {
      const ms = utc(2026, 6, 15, 12, 34, 56);
      expect(fmt(ms, 'Not/AZone')).toBe(system(ms));
      // Negative result is cached; a second call still works.
      expect(fmt(ms, 'Not/AZone')).toBe(system(ms));
    });
  });
});
