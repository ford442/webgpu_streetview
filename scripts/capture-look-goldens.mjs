#!/usr/bin/env node
/**
 * Capture docs/looks/<id>-webgpu.png from a running Street View session.
 *
 * This cloud/CI VM has no WebGPU adapter — run on a WebGPU Chrome/Edge host:
 *
 *   npm start
 *   REACT_APP_MAPS_API_KEY=... node scripts/capture-look-goldens.mjs
 *
 * Pins a single pano/heading and snapshots the WebGPU canvas per look.
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
  for (const id of LOOKS) {
    const url = `${BASE}/?look=${id}&lat=${PANO.lat}&lng=${PANO.lng}&heading=${PANO.heading}&pitch=${PANO.pitch}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);
    const canvas = page.locator('canvas').first();
    const dest = new URL(`${id}-webgpu.png`, outDir);
    await canvas.screenshot({ path: dest.pathname });
    console.log('captured', dest.pathname);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
