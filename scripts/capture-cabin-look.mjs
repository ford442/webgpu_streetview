#!/usr/bin/env node
/**
 * Capture cabin look-pass screenshots from e2e/fixtures/cabin-look on real
 * (software) WebGPU. Needs a vite dev server on E2E_BASE_URL.
 *
 *   npx vite --port 3217 &
 *   E2E_BASE_URL=http://127.0.0.1:3217 node scripts/capture-cabin-look.mjs [outDir] [name=query ...]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const outDir = process.argv[2] || 'cabin-look-out';
// Driver's-eye framing on the cluster + center stack (head pitch is degrees, +down).
const FRAME = 'pitch=25&w=640&h=360&frames=30';
const DEFAULT_SHOTS = {
  'day': `${FRAME}&night=0&alt=0.6`,
  'night-dome-off': `${FRAME}&night=1&hl=1`,
  'night-dome-on': `${FRAME}&night=1&hl=1&dome=1`,
};
const shots = process.argv.length > 3
  ? Object.fromEntries(process.argv.slice(3).map((a) => a.split(/=(.*)/s).slice(0, 2)))
  : DEFAULT_SHOTS;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader',
    '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'],
});
for (const [name, query] of Object.entries(shots)) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(name, 'pageerror', e.message));
  await page.goto(`${BASE}/e2e/fixtures/cabin-look/scene.html?${query}`);
  await page.waitForFunction(() => window.__out?.done, null, { timeout: 240000 });
  const out = await page.evaluate(() => window.__out);
  if (out.fatal) { console.error(name, out.fatal); await page.close(); continue; }
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(out.png.split(',')[1], 'base64'));
  console.log(name, out.backend, out.errors?.length ? out.errors : 'ok', out.probe ? JSON.stringify(out.probe) : '');
  await page.close();
}
await browser.close();
