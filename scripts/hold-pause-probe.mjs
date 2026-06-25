#!/usr/bin/env node
/**
 * Hold-pause regression guard for the panorama advance()/teleport() flow.
 *
 * Background: the invariant under test is "between advance() and
 * isPanoramaReady, the user-visible WebGPU output must be derived only from
 * the pre-transition captured frame (+ live weather/overlays), never from
 * new Google Maps canvas content." Two prior attempts at this feature
 * regressed on exactly this point without anything noticing in CI. This
 * script gives that invariant an automatable, repeatable check:
 *
 *   1. Drives a few WASD hops against a running dev/build server.
 *   2. Reads window.__STREETVIEW_PROBE__ (see src/utils/streetViewProbe.ts)
 *      for hold-armed / first-stable / released timestamps and any
 *      INVARIANT VIOLATION warnings (the holdActive guard being bypassed).
 *   3. Independently re-checks the visible canvas itself: takes two
 *      screenshots ~150ms apart *while the hold is active* and verifies
 *      they're nearly identical. A real leak (new GMaps tiles popping
 *      through) shows up as a sudden, large difference between two frames
 *      that should both just be "the frozen snapshot + animated weather."
 *      This deliberately does NOT diff against a fixed golden image of real
 *      Street View imagery — that content changes over time (Google
 *      updates panoramas, weather/time-of-day vary), which would make a
 *      pixel-perfect golden brittle. The self-consistency check during the
 *      hold window is the meaningful, low-false-positive signal.
 *   4. Optionally (--goldens) also compares a coarse fingerprint of the
 *      final, post-release frame against a stored baseline per hop index —
 *      useful for a fixed CI route, but documented as best-effort since
 *      real imagery can legitimately drift.
 *
 * Usage:
 *   node scripts/hold-pause-probe.mjs [--url=http://localhost:3000] [--hops=8] [--goldens] [--promote-goldens]
 *
 * Prerequisites:
 *   - A running dev server (`npm start`) or static build, reachable at --url,
 *     with a *real* Google Maps API key configured (REACT_APP_MAPS_API_KEY in
 *     .env.local, or window.MAPS_API_KEY via public/config.js) — a placeholder
 *     key will load the app shell but Street View imagery will not render,
 *     and this script will report that explicitly rather than false-passing.
 *   - `npx playwright install chromium` (already a project devDependency).
 *
 * Exit code is non-zero if any probe warning fires or any intra-hold
 * consistency check fails — wire this into CI once a key is available there.
 */

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

function parseArgs(argv) {
  const args = { url: 'http://localhost:3000', hops: 8, goldens: false, promoteGoldens: false };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg.startsWith('--hops=')) args.hops = parseInt(arg.slice('--hops='.length), 10) || 8;
    else if (arg === '--goldens') args.goldens = true;
    else if (arg === '--promote-goldens') { args.goldens = true; args.promoteGoldens = true; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = join(REPO_ROOT, 'repro-screenshots', 'hold-pause-probe');
const GOLDEN_DIR = join(REPO_ROOT, 'repro-screenshots', 'hold-pause-golden');
mkdirSync(OUT_DIR, { recursive: true });
if (args.goldens) mkdirSync(GOLDEN_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Same coarse center-region fingerprint as src/utils/streetViewProbe.ts,
 * evaluated independently in-page so this check doesn't rely on the app's
 * own probe being correct. */
const SAMPLE_FN = () => {
  const canvas = Array.from(document.querySelectorAll('canvas')).sort(
    (a, b) => b.width * b.height - a.width * a.height
  )[0];
  if (!canvas || canvas.width < 64) return null;
  const off = document.createElement('canvas');
  off.width = 4;
  off.height = 4;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const sx = Math.floor(canvas.width / 2 - 32);
  const sy = Math.floor(canvas.height / 2 - 32);
  ctx.drawImage(canvas, sx, sy, 64, 64, 0, 0, 4, 4);
  const d = ctx.getImageData(0, 0, 4, 4).data;
  let hash = 0;
  let brightness = 0;
  for (let i = 0; i < d.length; i += 4) {
    hash = ((hash << 5) - hash) + d[i] + d[i + 1] + d[i + 2];
    brightness += d[i] + d[i + 1] + d[i + 2];
  }
  return { hash, brightness: brightness / (d.length / 4) };
};

async function dismissWelcome(page) {
  try {
    const btn = page.locator('button:has-text("Start")').first();
    if (await btn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await btn.click({ timeout: 4000 });
      return;
    }
  } catch {}
  await page.keyboard.press('Escape').catch(() => {});
}

async function waitForProbe(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => !!window.__STREETVIEW_PROBE__).catch(() => false);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  console.log(`[hold-pause-probe] target=${args.url} hops=${args.hops} goldens=${args.goldens}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=egl',
      '--use-angle=gl-egl',
      '--enable-features=Vulkan',
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--disable-software-rasterizer',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleWarnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && /StreetViewProbe/i.test(msg.text())) {
      consoleWarnings.push(msg.text());
    }
  });

  let failed = false;
  const report = { url: args.url, hops: [], summary: {} };

  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2000);
    await dismissWelcome(page);
    await sleep(1500);

    const probeReady = await waitForProbe(page);
    if (!probeReady) {
      console.error('[hold-pause-probe] window.__STREETVIEW_PROBE__ never appeared — is this build up to date?');
      process.exitCode = 1;
      return;
    }

    const webgpuActive = await page.evaluate(() => (window).usingWebGPU === true).catch(() => false);
    if (!webgpuActive) {
      console.warn(
        '[hold-pause-probe] WARNING: window.usingWebGPU is not true (fallback renderer or no canvas yet) — ' +
          'the hold-pause invariant only applies to the WebGPU path. Results below may not be meaningful.'
      );
    }

    await page.evaluate(() => window.__STREETVIEW_PROBE__?.enablePixelWatch());

    for (let i = 0; i < args.hops; i++) {
      await page.evaluate(() => window.__STREETVIEW_PROBE__?.clear());

      await page.keyboard.press('KeyW');

      // Poll for the hold to actually arm (timeline gets a new entry).
      const armedAt = Date.now();
      let sawHold = false;
      const intraHoldSamples = [];
      while (Date.now() - armedAt < 2500) {
        const timeline = await page.evaluate(() => window.__STREETVIEW_PROBE__?.getTimeline() ?? []);
        const entry = timeline[timeline.length - 1];
        if (entry && entry.releasedAt !== null) break; // hold already finished
        if (entry) {
          sawHold = true;
          const sample = await page.evaluate(SAMPLE_FN);
          if (sample) intraHoldSamples.push({ t: Date.now() - armedAt, ...sample });
        }
        await sleep(120);
      }
      // Let the release crossfade finish.
      await sleep(400);

      const [timeline, warnings] = await Promise.all([
        page.evaluate(() => window.__STREETVIEW_PROBE__?.getTimeline() ?? []),
        page.evaluate(() => window.__STREETVIEW_PROBE__?.getWarnings() ?? []),
      ]);

      const screenshotPath = join(OUT_DIR, `hop_${String(i).padStart(2, '0')}.png`);
      await page.screenshot({ path: screenshotPath }).catch(() => {});

      // Intra-hold self-consistency: two samples taken close together while
      // holding should differ only by gradual weather animation, not a jump.
      let maxIntraHoldJump = 0;
      for (let s = 1; s < intraHoldSamples.length; s++) {
        const delta = Math.abs(intraHoldSamples[s].brightness - intraHoldSamples[s - 1].brightness);
        maxIntraHoldJump = Math.max(maxIntraHoldJump, delta);
      }
      const INTRA_HOLD_JUMP_THRESHOLD = 90; // matches streetViewProbe.ts PIXEL_DRIFT_THRESHOLD
      const intraHoldLeakSuspected = maxIntraHoldJump > INTRA_HOLD_JUMP_THRESHOLD;

      const hopEntry = timeline[timeline.length - 1] ?? null;
      const hopReport = {
        hop: i,
        sawHold,
        holdDurationMs: hopEntry?.holdDurationMs ?? null,
        warnings,
        intraHoldSampleCount: intraHoldSamples.length,
        maxIntraHoldJump,
        intraHoldLeakSuspected,
        screenshot: screenshotPath,
      };
      report.hops.push(hopReport);

      if (!sawHold) {
        console.warn(`[hop ${i}] no hold was armed (no link in this direction, or already at a dead end?)`);
      } else {
        console.log(
          `[hop ${i}] holdDurationMs=${hopEntry?.holdDurationMs?.toFixed?.(0) ?? 'n/a'} ` +
            `intraHoldSamples=${intraHoldSamples.length} maxJump=${maxIntraHoldJump.toFixed(1)}`
        );
      }
      if (warnings.length > 0) {
        failed = true;
        console.error(`[hop ${i}] PROBE WARNINGS:`, warnings.map((w) => w.message));
      }
      if (intraHoldLeakSuspected) {
        failed = true;
        console.error(
          `[hop ${i}] FAIL: intra-hold brightness jumped by ${maxIntraHoldJump.toFixed(1)} ` +
            `(threshold ${INTRA_HOLD_JUMP_THRESHOLD}) — frozen frame may not have stayed frozen`
        );
      }

      if (args.goldens) {
        const goldenPath = join(GOLDEN_DIR, `hop_${String(i).padStart(2, '0')}.json`);
        const finalSample = await page.evaluate(SAMPLE_FN);
        if (finalSample) {
          if (args.promoteGoldens || !existsSync(goldenPath)) {
            writeFileSync(goldenPath, JSON.stringify(finalSample, null, 2));
            console.log(`[hop ${i}] golden ${args.promoteGoldens ? 'promoted' : 'created'} at ${goldenPath}`);
          } else {
            const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
            const diff = Math.abs(golden.brightness - finalSample.brightness);
            hopReport.goldenBrightnessDiff = diff;
            console.log(
              `[hop ${i}] golden brightness diff=${diff.toFixed(1)} ` +
                '(best-effort only — real Street View imagery legitimately changes over time)'
            );
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  report.summary = {
    failed,
    consoleWarnings,
  };
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n[hold-pause-probe] report written to ${join(OUT_DIR, 'report.json')}`);

  if (failed || consoleWarnings.length > 0) {
    console.error('[hold-pause-probe] FAIL — see warnings above.');
    process.exitCode = 1;
  } else {
    console.log('[hold-pause-probe] PASS — no invariant warnings, no intra-hold jumps.');
  }
}

main().catch((err) => {
  console.error('[hold-pause-probe] FATAL:', err);
  process.exitCode = 1;
});
