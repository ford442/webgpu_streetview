#!/usr/bin/env node
/**
 * Renders the PNG share / install images from `public/icons/icon.svg` (#385):
 *
 *   public/icons/icon-192.png, icon-512.png   manifest `any` icons (PNG: Android/Chrome install
 *                                             and older iOS do not take an SVG manifest icon)
 *   public/icons/icon-maskable-512.png        manifest `maskable` icon (mark inside the 80 % safe zone)
 *   public/icons/apple-touch-icon.png         180×180, iOS home screen
 *   public/images/og-image.png                1200×630 Open Graph / Twitter card
 *
 * The outputs are committed; re-run after changing the SVG: `npm run gen:share-images`.
 * Uses the pinned Playwright Chromium (`E2E_CHROMIUM_PATH` overrides, as in the e2e config).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(path.join(root, 'public/icons/icon.svg'), 'utf8');
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const page = (body, w, h) => `<!doctype html><html><head><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#0a0a0a}
  body{display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
</style></head><body>${body}</body></html>`;

const jobs = [
  { out: 'public/icons/icon-192.png', w: 192, h: 192, transparent: true, body: `<img src="${svgUrl}" width="192" height="192">` },
  { out: 'public/icons/icon-512.png', w: 512, h: 512, transparent: true, body: `<img src="${svgUrl}" width="512" height="512">` },
  { out: 'public/icons/icon-maskable-512.png', w: 512, h: 512, body: `<img src="${svgUrl}" width="400" height="400">` },
  { out: 'public/icons/apple-touch-icon.png', w: 180, h: 180, body: `<img src="${svgUrl}" width="180" height="180">` },
  {
    out: 'public/images/og-image.png',
    w: 1200,
    h: 630,
    body: `<div style="display:flex;align-items:center;gap:56px;padding:0 80px">
      <img src="${svgUrl}" width="260" height="260">
      <div style="text-align:left">
        <div style="color:#4CAF50;font-size:76px;font-weight:800;letter-spacing:-2px;line-height:1.05">1ink.us Streetview</div>
        <div style="color:#e0e0e0;font-size:34px;margin-top:22px;line-height:1.35">Drive the world's streets in your browser —<br>WebGPU weather, night and a car cabin.</div>
      </div></div>`,
  },
];

const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
try {
  for (const job of jobs) {
    const p = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
    let html = page(job.body, job.w, job.h);
    if (job.transparent) html = html.replace('background:#0a0a0a', 'background:transparent');
    await p.setContent(html);
    await p.evaluate(() => Promise.all(Array.from(document.images, (i) => i.decode())));
    await p.screenshot({ path: path.join(root, job.out), omitBackground: Boolean(job.transparent) });
    await p.close();
    console.log(`wrote ${job.out}`);
  }
} finally {
  await browser.close();
}
