#!/usr/bin/env node
/**
 * Quick puppeteer probe for the StreetView flicker issue.
 * Navigates the live site, dumps canvases and Google Maps error UI,
 * and captures a short sequence of screenshots to spot flicker.
 */
import puppeteer from '/content/headless-chrome-nvidia-t4-gpu-support/examples/puppeteer/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = '/content/webgpu_streetview/repro-screenshots/flicker-probe';
const LOG_FILE = join(OUT_DIR, 'probe.log');
const URL = 'https://test.1ink.us/streetview/index.html';

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

async function dumpState(page, label) {
  return page.evaluate((lbl) => {
    const canvases = Array.from(document.querySelectorAll('canvas')).map((c, i) => ({
      i,
      w: c.width,
      h: c.height,
      z: getComputedStyle(c).zIndex,
      op: getComputedStyle(c).opacity,
      id: c.id,
      cls: c.className.slice(0, 40),
      parent: c.parentElement?.className?.slice(0, 30),
    }));
    const gmErr = Array.from(document.querySelectorAll('.gm-err-container, .gm-err-content, .gm-err-title, .gm-err-message')).map((el) => ({
      cls: el.className.slice(0, 40),
      txt: (el.textContent || '').slice(0, 120).replace(/\s+/g, ' '),
      z: getComputedStyle(el).zIndex,
      display: getComputedStyle(el).display,
      opacity: getComputedStyle(el).opacity,
    }));
    const alerts = Array.from(document.querySelectorAll('[role="alert"], [role="alertdialog"], .MuiAlert-root, .error-banner, .gm-err-dialog')).map((el) => ({
      cls: el.className.slice(0, 40),
      txt: (el.textContent || '').slice(0, 120).replace(/\s+/g, ' '),
    }));
    return { label: lbl, canvasCount: canvases.length, canvases, gmErrCount: gmErr.length, gmErr, alertCount: alerts.length, alerts };
  }, label);
}

async function main() {
  log(`Probing ${URL}`);
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--headless=new',
      '--enable-unsafe-webgpu',
      '--window-size=1280,720',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Force a bad-but-plausible key by seeding it before config.js runs and
  // making the setter ignore the empty value the deployed config.js writes.
  // This reproduces the auth-failure path that injects Google's .gm-err-* UI.
  await page.evaluateOnNewDocument(() => {
    const BAD_KEY = 'AIzaSyD3V3RY1nV3ry1nV3ry1nV3ry1nV3ry1nV3ry1n';
    Object.defineProperty(window, 'MAPS_API_KEY', {
      configurable: true,
      get() { return (window).__mapsKeyProbe || ''; },
      set(v) {
        if (typeof v === 'string' && v.trim().length > 10) {
          (window).__mapsKeyProbe = v.trim();
        }
        // ignore empty/placeholder values from config.js
      },
    });
    (window).__mapsKeyProbe = BAD_KEY;
  });

  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/auth|gm_authFailure|This page can't load|Oops|Something went wrong|Google Maps API key error/i.test(text)) {
      const line = `[AUTH ${msg.type()}] ${text}`;
      logs.push(line);
      log(line);
      return;
    }
    if (/gm_|google|maps|canvas|webgpu|error|warn/i.test(text)) {
      const line = `[CONSOLE ${msg.type()}] ${text}`;
      logs.push(line);
      log(line);
    }
  });
  page.on('pageerror', (err) => {
    const line = `[PAGEERROR] ${err.message}`;
    logs.push(line);
    log(line);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log('Navigation complete');
  const keyCheck = await page.evaluate(() => ({
    mapsKey: window.MAPS_API_KEY,
    probeKey: window.__mapsKeyProbe,
  }));
  log(`Runtime key check: ${JSON.stringify(keyCheck)}`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Wait for app/bootstrap, dismiss welcome if present
  await sleep(3500);
  try {
    const startBtn = await page.$('button:has-text("Start")');
    if (startBtn) {
      await startBtn.click();
      log('Clicked Start welcome button');
      await sleep(1200);
    } else {
      await page.keyboard.press('Escape');
      await sleep(800);
    }
  } catch (e) {
    log('Welcome dismiss fallback: Escape');
    await page.keyboard.press('Escape');
    await sleep(800);
  }

  const sequence = [];
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    const state = await dumpState(page, `t${(i * 0.5).toFixed(1)}s`);
    const fp = join(OUT_DIR, `frame_${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: fp, fullPage: false });
    sequence.push({ time: `${(i * 0.5).toFixed(1)}s`, screenshot: fp, ...state });
    if (state.gmErrCount > 0 || state.alertCount > 0) {
      log(`Frame ${i}: ${state.gmErrCount} gm-err elements, ${state.alertCount} alert elements`);
    }
  }

  writeFileSync(join(OUT_DIR, 'sequence.json'), JSON.stringify(sequence, null, 2));
  writeFileSync(join(OUT_DIR, 'console.log'), logs.join('\n'));
  log(`Probe complete. ${sequence.length} frames captured in ${OUT_DIR}`);
  await browser.close();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
