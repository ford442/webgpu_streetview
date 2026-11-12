import { test, expect } from '@playwright/test';
import { requireGpuAdapter } from './gpuLane';

/**
 * The atmosphere LUTs on a real WebGPU device (SwiftShader), against the C++
 * reference in the committed wasm:
 *
 * - the transmittance LUT matches `atmoTransmittanceLut` within 1e-3 (the
 *   GPU integrates in f32 and stores f16; the reference is f64);
 * - the pass rebuilds on change only: nothing for a still sun or a 0.05° move,
 *   sky view + aerial perspective for a 1° move;
 * - the sky view at the sunset looks (sun at 2°, −4°, −12°) has a horizon
 *   brighter toward the sun and a night sky far darker than dusk; in clear
 *   air with the sun 2° down, the anti-solar sky shows the Earth's shadow (a
 *   dark, blue band low down) under the pink Belt of Venus. (At the 23 km
 *   default the haze's multiple scattering washes the band out, as it does
 *   on a hazy evening.)
 * - aerial perspective thickens with distance and with haze.
 *
 * Unit tests pin the wiring against a fake device; this is where the WGSL
 * compiles and runs. `gpu` project (SwiftShader flags in playwright.config.ts).
 */

const FIXTURE = '/e2e/fixtures/atmosphere/luts.html';

interface Out {
  done?: boolean;
  fatal?: string;
  transmittance: Record<string, { maxAbsDiff: number; at: number[]; gpu: number; cpu: number }>;
  builds: Record<'still' | 'small' | 'moved', { medium: number; sun: number }>;
  sky: Record<string, { zenith: number; horizonSun: number; horizonAway: number; finite: boolean; min: number }>;
  earthShadow: { band: [number, number, number]; belt: [number, number, number] };
  aerial: Record<string, { haze300m: number; monotonic: boolean }>;
  uncaptured: string[];
}

test.setTimeout(180_000);

test('atmosphere LUTs: C++ parity, rebuild policy, sunset and haze', async ({ page }, testInfo) => {
  await page.goto(FIXTURE);
  await page.waitForFunction(
    () => (window as unknown as { __out?: { done?: boolean } }).__out?.done === true,
    undefined,
    { timeout: 170_000 },
  );
  const out = await page.evaluate(() => (window as unknown as { __out: Out }).__out);
  requireGpuAdapter(testInfo, out.fatal);
  expect(out.fatal, out.fatal).toBeUndefined();
  testInfo.annotations.push({ type: 'atmosphere', description: JSON.stringify(out) });

  for (const [label, t] of Object.entries(out.transmittance)) {
    expect(t.maxAbsDiff, `${label}: worst texel ${JSON.stringify(t)}`).toBeLessThan(1e-3);
  }

  expect(out.builds.still).toEqual({ medium: 0, sun: 0 });
  expect(out.builds.small).toEqual({ medium: 0, sun: 0 });
  expect(out.builds.moved).toEqual({ medium: 0, sun: 1 });

  for (const [sun, s] of Object.entries(out.sky)) {
    expect(s.finite, `sun ${sun}°`).toBe(true);
    expect(s.min, `sun ${sun}°`).toBeGreaterThanOrEqual(0);
  }
  const dusk = out.sky['2']!;
  const civil = out.sky['-4']!;
  const night = out.sky['-12']!;
  // Golden hour: the horizon under the sun outshines the zenith and the anti-solar horizon.
  expect(dusk.horizonSun).toBeGreaterThan(dusk.zenith);
  expect(dusk.horizonSun).toBeGreaterThan(dusk.horizonAway);
  // Earth shadow: the band is darker and bluer than the belt above it.
  const y = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const { band, belt } = out.earthShadow;
  expect(y(band)).toBeLessThan(y(belt));
  expect(band[2]).toBeGreaterThan(band[0]);
  expect(belt[0] / belt[2]).toBeGreaterThan(1.5);
  // Each step down darkens the whole sky; −12° is night next to 2°.
  expect(civil.zenith).toBeLessThan(dusk.zenith);
  expect(night.zenith).toBeLessThan(civil.zenith);
  expect(night.zenith * 50).toBeLessThan(dusk.zenith);

  const haze = out.aerial['5000m']!;
  const clear = out.aerial['50000m']!;
  expect(haze.monotonic).toBe(true);
  expect(clear.monotonic).toBe(true);
  expect(haze.haze300m).toBeGreaterThan(clear.haze300m);
  expect(clear.haze300m).toBeLessThan(0.05);

  expect(out.uncaptured).toEqual([]);
});
