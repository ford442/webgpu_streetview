import type { PanoLocationInfo } from '../../utils/panoLocation';
import { resolveTimeZone } from '../../utils/panoTimeZone';
import { DigitalClock } from './DigitalClock';

// Real lookup by default; individual tests swap in deferred promises.
vi.mock('../../utils/panoTimeZone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/panoTimeZone')>();
  return { ...actual, resolveTimeZone: vi.fn(actual.resolveTimeZone) };
});

const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number =>
  Date.UTC(y, mo - 1, d, h, mi, s);

/** 2026-01-15 12:00:00 UTC — Lisbon is on WET (UTC+0), Tokyo on JST (UTC+9). */
const WINTER_NOON_UTC = utc(2026, 1, 15, 12);

const info = (lat: number | null, lng: number | null): PanoLocationInfo => ({
  panoId: 'pano',
  description: null,
  lat,
  lng,
  address: null,
  captureDate: null,
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

let fillText: ReturnType<typeof vi.fn>;

/** Recording 2D context: unknown methods are no-ops, property writes stick. */
function stubCanvas(): void {
  fillText = vi.fn();
  const target: Record<string | symbol, unknown> = {
    fillText,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  const ctx = new Proxy(target, {
    get: (t, p) => (p in t ? t[p] : () => undefined),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext' as never).mockReturnValue(ctx as never);
}

/** Each draw paints the string twice (glow pass + crisp pass). */
const draws = (): number => fillText.mock.calls.length / 2;
const lastText = (): string => String(fillText.mock.calls.at(-1)![0]);
/** Time digits with the blinking separators normalised to ':'. */
const lastTime = (): string => lastText().replace(/ /g, ':');
const uploads = (clock: DigitalClock): number => clock.getMaterial().map!.version;

function makeClock(): DigitalClock {
  return new DigitalClock('#00ffcc', 'high');
}

/** Let the (real) dynamic-import lookup settle, then repaint at `ms`. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('DigitalClock', () => {
  beforeEach(() => {
    stubCanvas();
    vi.mocked(resolveTimeZone).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shows the panorama’s local time', () => {
    it('Tokyo: epoch 0 → 09:00:00', () => {
      const clock = makeClock();
      clock.setTimeZone('Asia/Tokyo');
      clock.update(0);
      expect(lastText()).toBe('09:00:00');
    });

    it('Lisbon across the spring-forward instant: 00:59:59 → 02:00:00', () => {
      const clock = makeClock();
      clock.setTimeZone('Europe/Lisbon');
      clock.update(utc(2026, 3, 29, 0, 59, 59));
      expect(lastTime()).toBe('00:59:59');
      clock.update(utc(2026, 3, 29, 1, 0, 0));
      expect(lastTime()).toBe('02:00:00');
    });

    it('Lisbon across the fall-back instant: 01:59:59 → 01:00:00', () => {
      const clock = makeClock();
      clock.setTimeZone('Europe/Lisbon');
      clock.update(utc(2026, 10, 25, 0, 59, 59));
      expect(lastTime()).toBe('01:59:59');
      clock.update(utc(2026, 10, 25, 1, 0, 0));
      expect(lastTime()).toBe('01:00:00');
    });

    it('blinks the separators with the seconds (odd → spaces)', () => {
      const clock = makeClock();
      clock.setTimeZone('Asia/Tokyo');
      clock.update(1000); // 09:00:01
      expect(lastText()).toBe('09 00 01');
      clock.update(2000); // 09:00:02
      expect(lastText()).toBe('09:00:02');
    });

    it('null zone → the viewer’s system time', () => {
      const clock = makeClock();
      const ms = utc(2026, 6, 15, 12, 34, 56);
      clock.update(ms);
      const d = new Date(ms);
      const p = (n: number) => String(n).padStart(2, '0');
      expect(lastTime()).toBe(`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    });
  });

  describe('texture upload is gated to actual changes', () => {
    it('redraws + uploads once per second, not per frame', () => {
      const clock = makeClock();
      clock.setTimeZone('Asia/Tokyo');
      clock.update(10_000);
      const d0 = draws();
      const v0 = uploads(clock);

      // A burst of frames inside the same wall-clock second.
      for (const ms of [10_016, 10_033, 10_400, 10_999]) clock.update(ms);
      expect(draws()).toBe(d0);
      expect(uploads(clock)).toBe(v0);

      clock.update(11_000);
      expect(draws()).toBe(d0 + 1);
      expect(uploads(clock)).toBe(v0 + 1);
    });

    it('a zone change repaints immediately, within the same second', () => {
      const clock = makeClock();
      clock.setTimeZone('Asia/Tokyo');
      clock.update(10_000);
      const d0 = draws();

      clock.setTimeZone('Europe/Lisbon');
      clock.update(10_100);
      expect(draws()).toBe(d0 + 1);
      expect(lastTime()).toBe('01:00:10');
    });

    it('re-setting the same zone, or an equivalent one, does not repaint', () => {
      const clock = makeClock();
      clock.setTimeZone('UTC');
      clock.update(10_000);
      const d0 = draws();
      const v0 = uploads(clock);

      clock.setTimeZone('UTC');
      clock.update(10_100);
      clock.setTimeZone('Etc/UTC'); // different name, identical wall-clock string
      clock.update(10_200);
      expect(draws()).toBe(d0);
      expect(uploads(clock)).toBe(v0);
    });
  });

  describe('setLocation → zone lookup', () => {
    it('resolves the pano’s coordinates offline (Tokyo)', async () => {
      const clock = makeClock();
      clock.setLocation(info(35.6762, 139.6503));
      await settle();
      clock.update(0);
      expect(lastText()).toBe('09:00:00');
    });

    it('does not re-run the lookup for unchanged coordinates', async () => {
      const clock = makeClock();
      clock.setLocation(info(35.6762, 139.6503));
      clock.setLocation(info(35.6762, 139.6503));
      await settle();
      expect(resolveTimeZone).toHaveBeenCalledTimes(1);
    });

    it('missing coordinates fall back to system time immediately', async () => {
      const clock = makeClock();
      clock.setLocation(info(35.6762, 139.6503));
      await settle();
      clock.setLocation(info(null, null));
      const ms = utc(2026, 6, 15, 12, 34, 56);
      clock.update(ms);
      const d = new Date(ms);
      const p = (n: number) => String(n).padStart(2, '0');
      expect(lastTime()).toBe(`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    });

    it('ignores a late lookup for an older pano', async () => {
      const first = deferred<string | null>();
      const second = deferred<string | null>();
      vi.mocked(resolveTimeZone)
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);

      const clock = makeClock();
      clock.setLocation(info(35.6762, 139.6503)); // hop A (Tokyo)
      clock.setLocation(info(38.7223, -9.1393)); //  hop B (Lisbon)

      second.resolve('Europe/Lisbon');
      await settle();
      first.resolve('Asia/Tokyo'); // A finishes after B — must not win
      await settle();

      clock.update(WINTER_NOON_UTC);
      expect(lastText()).toBe('12:00:00'); // Lisbon in January = UTC+0 (Tokyo would be 21:00:00)
    });

    it('keeps the previous zone on screen while the next hop resolves', async () => {
      const clock = makeClock();
      clock.setLocation(info(35.6762, 139.6503));
      await settle();

      const pending = deferred<string | null>();
      vi.mocked(resolveTimeZone).mockImplementationOnce(() => pending.promise);
      clock.setLocation(info(38.7223, -9.1393));
      clock.update(WINTER_NOON_UTC);
      expect(lastText()).toBe('21:00:00'); // still Tokyo, no flash of system time

      pending.resolve('Europe/Lisbon');
      await settle();
      clock.update(WINTER_NOON_UTC + 1000);
      expect(lastTime()).toBe('12:00:01');
    });

    it('a lookup that resolves after dispose is ignored', async () => {
      const pending = deferred<string | null>();
      vi.mocked(resolveTimeZone).mockImplementationOnce(() => pending.promise);

      const clock = makeClock();
      clock.setLocation(info(35.6762, 139.6503));
      clock.dispose();
      const d0 = draws();

      pending.resolve('Asia/Tokyo');
      await settle();
      expect(() => clock.update(0)).not.toThrow();
      expect(draws()).toBe(d0);
    });
  });
});
