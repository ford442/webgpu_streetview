#!/usr/bin/env node
/**
 * Capture docs/looks/<id>-webgpu.png from a running Street View session.
 *
 * This cloud/CI VM has no WebGPU adapter — run on a WebGPU Chrome/Edge host:
 *
 *   npm start
 *   REACT_APP_MAPS_API_KEY=... node scripts/capture-look-goldens.mjs
 *
 * Pins a single pano/heading and snapshots the WebGPU canvas per look. With
 * the depth model fetched (`npm run fetch:depth-model`) it also captures each
 * look with scene depth on at Ultra (`<id>-depth-webgpu.png`, #320); set
 * DEPTH=0 to skip. Keyless, reproducible depth pairs: `npm run capture:depth-looks`.
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const LOOKS = ['clear', 'noir', 'golden-hour', 'teal-orange'];
const PANO = {
  lat: '36.0544',
  lng: '-112.1401',
  heading: '90',
  pitch: '0',
};

const outDir = new URL('../docs/looks/', import.meta.url);

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const variants = process.env.DEPTH === '0'
    ? [{ suffix: '', query: '' }]
    : [{ suffix: '', query: '' }, { suffix: '-depth', query: '&quality=ultra&depth=on' }];
  for (const id of LOOKS) {
    for (const { suffix, query } of variants) {
      const url = `${BASE}/?look=${id}&lat=${PANO.lat}&lng=${PANO.lng}&heading=${PANO.heading}&pitch=${PANO.pitch}${query}`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(4000);
      if (suffix) {
        // The first map, then a moment for trust to ramp to the preset weight.
        await page.waitForFunction(
          () => {
            const d = /** @type {any} */ (window).__SCENE_DEPTH__;
            return d?.state === 'failed' || (d?.generation ?? 0) >= 1;
          },
          undefined,
          { timeout: 120000 },
        );
        await page.waitForTimeout(1000);
      }
      const canvas = page.locator('canvas').first();
      const dest = new URL(`${id}${suffix}-webgpu.png`, outDir);
      await canvas.screenshot({ path: dest.pathname });
      console.log('captured', dest.pathname);
    }
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
