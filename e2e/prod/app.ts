/**
 * Shared plumbing for the production smoke (`e2e/prod/`): which target this run is, what commit it
 * expects, whether Street View can run, and how to open the app on a sub-path host.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { dismissWelcome, hasMapsKey } from '../helpers';

const loopback = (hostname: string): boolean => /^(127\.0\.0\.1|localhost|\[::1\])$/.test(hostname);

/** A deployed site (`E2E_BASE_URL` is not this machine): specs spend real, metered Maps calls — keep them few. */
export const LIVE: boolean = (() => {
  const raw = process.env.E2E_BASE_URL;
  return raw ? !loopback(new URL(raw).hostname) : false;
})();

/** The commit this run must be looking at: `E2E_EXPECT_SHA`, else the local `build/build-info.json`. */
export function expectedSha(): string | null {
  const fromEnv = process.env.E2E_EXPECT_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    const info = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'build', 'build-info.json'), 'utf8')) as { sha?: string };
    return info.sha ?? null;
  } catch {
    return null;
  }
}

/**
 * Street View (and so the renderer, the cabin, the trip drive) needs a Maps key: the deployed site
 * has one baked in; against a local preview it is one built with `REACT_APP_MAPS_API_KEY`, or a key
 * handed to the page at run time with `E2E_MAPS_API_KEY` (served through `config.js`, never built in).
 */
export const KEYED: boolean = LIVE || hasMapsKey || Boolean(process.env.E2E_MAPS_API_KEY);

/** Why a keyed flow is skipped, in one phrase for `test.skip`. */
export const NEEDS_KEY = 'needs a Maps key: run live, build with REACT_APP_MAPS_API_KEY, or set E2E_MAPS_API_KEY';

/**
 * Hand the page a Maps key at run time through `config.js` (the runtime config the app reads before
 * its bundle), exactly as a deploy would. `key` defaults to `E2E_MAPS_API_KEY`; pass `''` or a bogus
 * key to test the keyless / invalid-key banners. Never done against a live site, whose key is its own.
 */
export async function useMapsKey(page: Page, key: string | undefined = process.env.E2E_MAPS_API_KEY): Promise<void> {
  if (LIVE || key === undefined) return;
  await page.route('**/config.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: `window.MAPS_API_KEY = ${JSON.stringify(key)};\n` }),
  );
}

/**
 * Open the app. `query` is relative to the base URL (`'?cabin=webgl'`), which keeps a `/streetview/`
 * sub-path intact — a leading-slash path would drop it. A host that rate-limits (429 + Retry-After,
 * as test.1ink.us does for bursts) is waited out for the document only; a 429 on an asset is a real failure.
 */
export async function openApp(page: Page, query = '', options: { welcome?: boolean } = {}): Promise<void> {
  let status = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await page.goto(`./${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    status = response?.status() ?? 0;
    if (status !== 429 || !LIVE) break;
    const wait = Number(response?.headers()['retry-after']) || 5;
    await page.waitForTimeout(Math.min(wait, 60) * 1000);
  }
  expect(status, `GET ${page.url()} must answer 2xx`).toBeLessThan(400);
  await page.waitForSelector('#root', { timeout: 30_000 });
  if (options.welcome ?? true) await dismissWelcome(page);
}

/**
 * Wait for the WebGPU renderer to be ready (`webgpuProbe.stage === 'ok'`) after Street View connects.
 * Keyed flows start here. Fails with the probe's own reason when boot hard-fails.
 */
export async function waitForRenderer(page: Page, timeout = 120_000): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const probe = (window as unknown as SvWindow).webgpuProbe;
          return probe ? (probe.ok ? 'ok' : `failed at ${probe.stage}: ${probe.reason}`) : 'pending';
        }),
      { timeout, message: 'webgpuProbe never reached ok' },
    )
    .toBe('ok');
}

/** Street View point of view and the session's Maps call meter, through the hold-pause probe. */
export async function readPov(page: Page): Promise<{ heading: number; pitch: number; zoom: number; carHeading: number }> {
  return page.evaluate(() => {
    const probe = (window as unknown as SvWindow).__STREETVIEW_PROBE__;
    if (!probe) throw new Error('window.__STREETVIEW_PROBE__ is not installed');
    return probe.getTripRecordings().pov;
  });
}

export interface CallBudgetSnapshot {
  total: number;
  panorama: number;
  placeSearch: number;
  directions: number;
  routing: number;
  bySource: Record<string, number>;
}

export async function readCallBudget(page: Page): Promise<CallBudgetSnapshot> {
  return page.evaluate(() => {
    const stats = (window as unknown as SvWindow).__STREETVIEW_PROBE__?.getCallBudget();
    if (!stats) throw new Error('window.__STREETVIEW_PROBE__ is not installed');
    return {
      total: stats.total,
      panorama: stats.byKind.panorama.used,
      placeSearch: stats.byKind.placeSearch.used,
      directions: stats.byKind.directions.used,
      routing: stats.byKind.routing.used,
      bySource: { ...stats.bySource },
    };
  });
}

/** Smallest angle between two compass headings, degrees. */
export const headingDelta = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

/** `window` as the specs read it (the app's own typings are not part of the e2e project). */
export interface SvWindow {
  __SV__?: {
    build: { sha: string; shortSha: string; version: string; builtAt: string; dirty: boolean; ref: string | null };
    contexts?: { isolation?: { crossOriginIsolated?: boolean } };
    perf?: { frames?: number };
  };
  webgpuProbe?: {
    ok: boolean;
    stage: string;
    reason: string;
    passes: Record<string, { state: 'ready' | 'failed'; reason?: string }>;
    renderScale?: { scale: number } | undefined;
  };
  rendererType?: string;
  __STREETVIEW_PROBE__?: {
    getTimeline(): Array<{ armedAt: number; releasedAt: number | null }>;
    getWarnings(): unknown[];
    getCallBudget(): {
      total: number;
      byKind: Record<'panorama' | 'placeSearch' | 'directions' | 'routing', { used: number; blocked: number }>;
      bySource: Record<string, number>;
    };
    getTrip(): { status: string; alongM: number | null; lengthM: number | null; resnaps: number; error: string | null };
    getTripRecordings(): { pov: { heading: number; pitch: number; zoom: number; carHeading: number } };
    enablePixelWatch(): void;
    clear(): void;
  };
  __VEHICLE__?: { speedKmh: number; rpm: number; gear: string; speedMps: number };
  __CABIN_AUDIO_PROBE__?: { mode: string; ready: boolean; rendered: number; underruns: number; contexts: number; error?: string };
  __CABIN_RENDERER_PROBE__?: {
    backend: string;
    ready: boolean;
    composited?: boolean;
    compositeReason?: string;
    portal?: { active: boolean; reason?: string; clipDistances: boolean };
  };
  __GPU_CHORES__?: { killSwitch: boolean; backend: string };
}

/** Attach a named screenshot to the report; also written to `E2E_SCREENSHOT_DIR` when set (State of the App). */
export async function snapshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const png = await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body: png, contentType: 'image/png' });
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), png);
  }
}
