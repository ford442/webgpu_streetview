#!/usr/bin/env node
/**
 * Capture the scene-depth look goldens (#320) — docs/looks/scene-depth/.
 *
 * Runs the production renderer and the real depth model on a fixed CC0 street
 * photo (e2e/fixtures/scene-depth/), so the before/after pairs are reproducible
 * without a Maps key or a billable panorama load:
 *
 *   npm run fetch:depth-model
 *   npm start                                    # or any dev server
 *   E2E_BASE_URL=http://127.0.0.1:3000 npm run capture:depth-looks
 *
 * Each golden is a side-by-side pair: left, the depth proxy only (what ships at
 * Low/Medium or with scene depth off); right, the depth map at the Ultra weight.
 * `fog`, `rain`, `dof`, `dolly` (a mid-release frame of a forward hop) and
 * `depth-map` (the photo and the map the network produced). JPEG, 480 px per
 * half: these illustrate — the exact pixel assertions are in
 * e2e/scene-depth.spec.ts. Defaults to Chromium's SwiftShader adapter
 * (≈1–2 min per map); `GPU=hardware` uses the host GPU instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'looks', 'scene-depth');
const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const WEIGHT = 0.8; // Ultra's depthBlend

const SWIFTSHADER = [
  '--no-sandbox',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  '--use-vulkan=swiftshader',
  '--use-angle=swiftshader',
  '--use-webgpu-adapter=swiftshader',
];
const HARDWARE = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan,WebGPU'];

/** @param {string} dataUrl @param {string} name */
function save(dataUrl, name) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('captured', path.relative(root, file), `${Math.round(fs.statSync(file).size / 1024)} KB`);
}

/**
 * Two captures side by side, labelled, as a JPEG data URL — composed in the
 * page so the script needs no image library.
 * @param {import('playwright').Page} page @param {string} left @param {string} right
 * @param {[string, string]} labels
 */
function pair(page, left, right, labels) {
  return page.evaluate(async ([a, b, la, lb]) => {
    const load = async (/** @type {string} */ src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    };
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const half = 480;
    const h = Math.round((ia.height / ia.width) * half);
    const c = document.createElement('canvas');
    c.width = half * 2 + 4;
    c.height = h;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(ia, 0, 0, half, h);
    ctx.drawImage(ib, half + 4, 0, half, h);
    ctx.font = '600 15px system-ui, sans-serif';
    for (const [text, x] of /** @type {const} */ ([[la, 8], [lb, half + 12]])) {
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 4, 6, w + 8, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x, 22);
    }
    return c.toDataURL('image/jpeg', 0.85);
  }, /** @type {const} */ ([left, right, labels[0], labels[1]]));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU === 'hardware' ? HARDWARE : SWIFTSHADER,
  });
  const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`${BASE}/e2e/fixtures/scene-depth/scene.html`);
  await page.waitForFunction(() => /** @type {any} */ (window).__sceneReady === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => /** @type {any} */ (window).__scene.boot());

  const capture = (/** @type {string} */ look, /** @type {number} */ blend, /** @type {boolean} */ enabled) =>
    page.evaluate(async ([l, b, e]) => {
      const s = /** @type {any} */ (window).__scene;
      s.setLook(l);
      s.setDepth({ enabled: e, blend: b });
      return (await s.capture({ png: true })).png;
    }, /** @type {const} */ ([look, blend, enabled]));

  const looks = ['fog', 'rain', 'dof'];
  /** @type {Record<string, string>} */
  const proxy = {};
  for (const look of ['clear', ...looks]) proxy[look] = await capture(look, 0, false);
  const releaseFrame = () => page.evaluate(async () => {
    const s = /** @type {any} */ (window).__scene;
    s.setLook('clear');
    return (await s.release({ travelHeading: 0, progress: 0.5, png: true })).png;
  });
  const crossfade = await releaseFrame();

  await page.evaluate((w) => /** @type {any} */ (window).__scene.setDepth({ enabled: true, blend: w }), WEIGHT);
  const stats = await page.evaluate(() => /** @type {any} */ (window).__scene.waitForMaps(1, 900_000));
  if (stats.state !== 'ready') throw new Error(`scene depth did not come up: ${stats.reason}`);
  console.log(`depth: ${stats.variant}, ${Math.round(stats.inferenceMs)} ms, ${stats.inputWidth}×${stats.inputHeight}`);

  const labels = /** @type {[string, string]} */ (['depth proxy (today)', `scene depth (weight ${WEIGHT})`]);
  for (const look of looks) {
    save(await pair(page, proxy[look], await capture(look, WEIGHT, true), labels), `${look}-webgpu.jpg`);
  }
  const map = await page.evaluate(() => /** @type {any} */ (window).__scene.depthMap());
  save(await pair(page, proxy.clear, map.png, ['photo (pass-1 frame)', 'depth map (white = far)']), 'depth-map-webgpu.jpg');
  save(await pair(page, crossfade, await releaseFrame(), ['hop release: crossfade', 'hop release: depth dolly']), 'dolly-webgpu.jpg');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
