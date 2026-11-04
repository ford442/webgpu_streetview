#!/usr/bin/env node
/**
 * Capture the semantic-scene look goldens (#352) — docs/looks/semantic/.
 *
 * Runs the production renderer, the real depth model and the rebuilt semantic
 * model on a fixed CC0 street photo (e2e/fixtures/scene-depth/street.jpg), so
 * the before/after pairs are reproducible without a Maps key or a billable
 * panorama load:
 *
 *   npm run fetch:models
 *   npm start                                    # or any dev server
 *   E2E_BASE_URL=http://127.0.0.1:3000 npm run capture:semantic-looks
 *
 * Each golden is a side-by-side pair at Ultra's weights (scene depth 0.8 on
 * both sides): left, the semantic layer off; right, on (weight 1). `rain`
 * (sky mask, wet road, replaced overcast sky), `snow` (cover on the ground
 * only), `night` (class-conditional relight), `dusk` (golden-hour sky
 * replacement) and `class-map` (the photo and the network's classes). JPEG,
 * 480 px per half: these illustrate — the exact pixel assertions are in
 * e2e/scene-semantic.spec.ts. Defaults to Chromium's SwiftShader adapter
 * (a few minutes for the first maps); `GPU=hardware` uses the host GPU.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'looks', 'semantic');
const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const DEPTH_WEIGHT = 0.8; // Ultra's depthBlend
const SEMANTIC_WEIGHT = 1; // Ultra's semanticBlend

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
  await page.evaluate(() => /** @type {any} */ (window).__scene.boot({ photo: 'street' }));

  const capture = (/** @type {string} */ look, /** @type {boolean} */ semantic) =>
    page.evaluate(async ([l, on, w]) => {
      const s = /** @type {any} */ (window).__scene;
      s.setLook(l);
      s.setSemantic({ enabled: true, blend: on ? w : 0 });
      return (await s.capture({ png: true })).png;
    }, /** @type {const} */ ([look, semantic, SEMANTIC_WEIGHT]));

  await page.evaluate((w) => /** @type {any} */ (window).__scene.setDepth({ enabled: true, blend: w }), DEPTH_WEIGHT);
  await page.evaluate((w) => /** @type {any} */ (window).__scene.setSemantic({ enabled: true, blend: w }), SEMANTIC_WEIGHT);
  const stats = await page.evaluate(() => /** @type {any} */ (window).__scene.waitForSemanticMaps(1, 1_200_000));
  if (stats.state !== 'ready') throw new Error(`the semantic layer did not come up: ${stats.reason}`);
  console.log(`semantic: ${Math.round(stats.inferenceMs)} ms, ${stats.width}×${stats.height}, `
    + `sky colour ${JSON.stringify(stats.skyColor)}, sky edge ${stats.skyEdgeY}, histogram ${JSON.stringify(stats.histogram)}`);

  // Weight 0 is bit-exact with the layer off (e2e/scene-semantic.spec.ts), so
  // "off" is the live map at weight 0 — no second map needed.
  const labels = /** @type {[string, string]} */ (['scene depth only (today)', `+ semantic layer (weight ${SEMANTIC_WEIGHT})`]);
  for (const look of ['rain', 'snow', 'night', 'dusk']) {
    save(await pair(page, await capture(look, false), await capture(look, true), labels), `${look}-webgpu.jpg`);
  }
  const map = await page.evaluate(() => /** @type {any} */ (window).__scene.semanticMap());
  save(await pair(page, await capture('clear', false), map.png, ['photo (pass-1 frame)', 'classes (sky road sidewalk building vegetation vehicle person)']), 'class-map-webgpu.jpg');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
