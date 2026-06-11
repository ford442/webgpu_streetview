import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const REPRO_DIR = '/content/webgpu_streetview/repro-screenshots';
const LOG_FILE = '/content/webgpu_streetview/repro-screenshots/repro-log.txt';
const TARGET_URL = 'https://test.1ink.us/streetview/index.html';

const logs = [];
const networkEvents = [];

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  const entry = `[${ts}] [${level}] ${msg}`;
  console.log(entry);
  logs.push(entry);
  fs.appendFileSync(LOG_FILE, entry + '\n');
}

async function dumpCanvases(page, label) {
  const info = await page.evaluate((lbl) => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const results = canvases.map((c, i) => {
      const rect = c.getBoundingClientRect();
      const style = window.getComputedStyle(c);
      let sample = null;
      try {
        const ctx = c.getContext('2d', {willReadFrequently: true}) || c.getContext('webgl') || c.getContext('webgl2');
        if (ctx && ctx.readPixels) {
          // webgl sample rough
          sample = 'webgl-context';
        } else if (ctx && c.width > 0) {
          const d = ctx.getImageData ? ctx.getImageData(Math.min(10, c.width-1), Math.min(10, c.height-1), 1, 1) : null;
          sample = d ? `rgba(${d.data[0]},${d.data[1]},${d.data[2]},${d.data[3]})` : 'no-getImageData';
        }
      } catch(e) { sample = 'tainted-or-error:' + e.message; }
      return {
        index: i,
        width: c.width,
        height: c.height,
        clientWidth: c.clientWidth,
        clientHeight: c.clientHeight,
        rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
        zIndex: style.zIndex,
        opacity: style.opacity,
        visibility: style.visibility,
        display: style.display,
        position: style.position,
        pointerEvents: style.pointerEvents,
        id: c.id || '',
        className: c.className || '',
        'data-*': Object.fromEntries(Array.from(c.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value])),
        parentId: c.parentElement ? (c.parentElement.id || c.parentElement.className || 'no-id') : 'no-parent',
        sample
      };
    });
    // Also look for gm-style containers, error messages
    const gmContainers = Array.from(document.querySelectorAll('.gm-style, [class*="gm-"], .gm-err-container, [aria-label*="Google"]'));
    const gmInfo = gmContainers.slice(0, 8).map(el => ({
      tag: el.tagName,
      class: el.className,
      rect: el.getBoundingClientRect ? {w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height)} : null,
      style: {zIndex: window.getComputedStyle(el).zIndex, opacity: window.getComputedStyle(el).opacity, display: window.getComputedStyle(el).display},
      text: (el.textContent || '').slice(0, 120)
    }));
    const webgpuCanvas = document.querySelector('canvas'); // first often webgpu
    return { label: lbl, count: canvases.length, canvases: results, gmRelated: gmInfo, hasWebGPULike: !!webgpuCanvas };
  }, label);
  log(`CANVAS DUMP [${label}]: ${info.count} canvases. GM-related elems: ${info.gmRelated.length}`, 'DEBUG');
  info.canvases.forEach((c, idx) => {
    if (c.width > 100 || c.height > 100) {
      log(`  Canvas[${idx}]: ${c.width}x${c.height} (client ${c.clientWidth}x${c.clientHeight}) z=${c.zIndex} op=${c.opacity} vis=${c.visibility} pos=${c.position} id="${c.id}" cls="${c.className}" parent="${c.parentId}" sample~${c.sample}`, 'DEBUG');
    }
  });
  return info;
}

async function takeScreenshot(page, name) {
  const fp = path.join(REPRO_DIR, name);
  await page.screenshot({ path: fp, fullPage: false, type: 'png' });
  log(`SCREENSHOT: ${name}`);
  return fp;
}

async function waitForStable(page, ms = 2000) {
  await page.waitForTimeout(ms);
}

async function simulateHardRefresh(page) {
  log('ACTION: Simulating hard refresh (reload with cache bypass intent)');
  await page.evaluate(() => { try { performance.clearResourceTimings(); } catch(e){} });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
}

async function dismissWelcome(page) {
  log('Waiting for welcome modal / Start Exploring button...');
  // Try multiple selectors used historically
  const candidates = [
    'button:has-text("Start Exploring")',
    'button:has-text("Start")',
    'button[aria-label*="start" i]',
    'text="Start Exploring"',
    '.welcome button',
    '#welcome button'
  ];
  for (const sel of candidates) {
    try {
      const btn = await page.locator(sel).first();
      if (await btn.isVisible({timeout: 3000}).catch(()=>false)) {
        await btn.click({ timeout: 5000 });
        log(`Clicked welcome button via ${sel}`);
        await page.waitForTimeout(1200);
        return true;
      }
    } catch (e) {}
  }
  // Fallback: press Escape or Enter
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  log('Fallback: sent Escape/Enter to dismiss modal');
  await page.waitForTimeout(1000);
  return false;
}

async function pressKeyMultiple(page, key, count = 3, delay = 180) {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(delay);
  }
}

async function enableCruiseIfPossible(page) {
  // Try keyboard shortcuts first (common: 'c' for cruise? or look in code)
  // From useCruiseMode etc, often bound to key or UI button.
  log('Trying to enable cruise mode...');
  await page.keyboard.press('KeyC'); // may be car or cruise
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(300);
  // Look for cruise toggle in UI
  const cruiseSel = 'button[aria-label*="cruise" i], [data-testid*="cruise"], label:has-text("cruise"), text=/cruise/i';
  try {
    const el = await page.locator(cruiseSel).first();
    if (await el.isVisible({timeout: 1500}).catch(()=>false)) {
      await el.click();
      log('Clicked cruise UI element');
    }
  } catch(e){}
  await page.waitForTimeout(1500);
}

async function toggleCarMode(page) {
  log('ACTION: Toggling car mode (KeyC or button)');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(600);
}

async function triggerQualityChange(page) {
  // Hard in headless; try opening settings and clicking presets if labels visible, or just log
  log('ACTION: Attempting quality preset change (may be UI only)');
  await page.keyboard.press('KeyS'); // guess settings
  await page.waitForTimeout(400);
  const qualityBtns = page.locator('button:has-text("Low"), button:has-text("Ultra"), [aria-label*="quality" i]');
  try {
    if (await qualityBtns.first().isVisible({timeout: 1200}).catch(()=>false)) {
      await qualityBtns.first().click();
      await page.waitForTimeout(300);
      await qualityBtns.nth(3).click().catch(()=>{});
    }
  } catch(e){}
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}

async function main() {
  fs.mkdirSync(REPRO_DIR, { recursive: true });
  if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  log('=== REPRODUCTION SCRIPT START ===');
  log(`Target: ${TARGET_URL}`);
  log('Launching browser with GPU + WebGPU flags...');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=egl',
      '--use-angle=gl-egl',
      '--enable-features=Vulkan,WebGPU',
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      // High perf
      '--force-color-profile=srgb',
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1.5,  // high-ish dPR
    recordVideo: { dir: path.join(REPRO_DIR, 'videos'), size: { width: 1920, height: 1080 } },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });

  // Collect all events
  context.on('weberror', err => log(`[WEBERROR] ${err.error?.message || err}`, 'ERROR'));
  const page = await context.newPage();

  page.on('console', msg => {
    const txt = msg.text();
    const type = msg.type().toUpperCase();
    const entry = `[CONSOLE ${type}] ${txt}`;
    logs.push(entry);
    if (/gm_|google|maps|canvas|webgpu|webgl|device lost|context lost|copyExternal|texture|auth|error|warn/i.test(txt) || type === 'ERROR') {
      console.log(entry);
      fs.appendFileSync(LOG_FILE, entry + '\n');
    }
  });
  page.on('pageerror', err => {
    const entry = `[PAGEERROR] ${err.message}\n${err.stack || ''}`;
    logs.push(entry);
    console.log(entry);
    fs.appendFileSync(LOG_FILE, entry + '\n');
  });
  page.on('requestfailed', req => {
    const entry = `[REQ-FAILED] ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`;
    networkEvents.push(entry);
    if (/maps|streetview|googleapis|tiles/i.test(req.url())) {
      log(entry, 'NET');
    }
  });
  page.on('response', resp => {
    if (resp.status() >= 400 && /maps|streetview|googleapis/i.test(resp.url())) {
      const entry = `[RESP-ERR ${resp.status()}] ${resp.url()}`;
      networkEvents.push(entry);
      log(entry, 'NET');
    }
  });

  // CDP for advanced network throttling later
  let cdpSession = null;
  try {
    cdpSession = await context.newCDPSession(page);
    log('CDP session acquired for network emulation');
  } catch(e) {
    log('CDP session failed (throttling limited): ' + e.message, 'WARN');
  }

  // === 1. INITIAL LOAD ===
  log('STEP 1: Navigate to live site');
  const gotoStart = Date.now();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log(`Goto completed in ${Date.now() - gotoStart}ms`);

  await waitForStable(page, 2500);
  await dumpCanvases(page, 'post-goto');

  // Wait for loading overlay to clear (if present) + welcome
  log('Waiting for app to become interactive (up to 25s)...');
  await page.waitForTimeout(4000); // let GM bootstrap + observer run

  await dismissWelcome(page);
  await waitForStable(page, 3000);

  // Press P for perf stats overlay (confirms WebGPU path)
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(800);
  log('Pressed P for performance stats');

  await dumpCanvases(page, 'after-welcome-dismiss');
  const s1 = await takeScreenshot(page, '01_idle_baseline.png');

  // Baseline idle 30s
  log('Baseline idle observation: waiting 30s...');
  await page.waitForTimeout(15000);
  await dumpCanvases(page, 'idle-15s');
  await page.waitForTimeout(15000);
  await dumpCanvases(page, 'idle-30s');
  const s1b = await takeScreenshot(page, '01b_idle_30s.png');

  // === 2. INITIAL LOAD FLICKER (reload) ===
  log('\n=== STEP 2: Hard reload / initial load flicker test ===');
  await simulateHardRefresh(page);
  await page.waitForTimeout(2000);
  await dismissWelcome(page).catch(()=>{});
  await page.waitForTimeout(3000);
  await dumpCanvases(page, 'post-reload-3s');
  await takeScreenshot(page, '02_initial_reload_3s.png');

  // Watch critical first 10-15s closely, rapid screenshots
  for (let i=0; i<6; i++) {
    await page.waitForTimeout(1800);
    await dumpCanvases(page, `reload-t+${(i+1)*1.8}s`);
    await takeScreenshot(page, `02_reload_t${String(i+1).padStart(2,'0')}.png`);
  }

  // === 3. PANO TRANSITION TEST ===
  log('\n=== STEP 3: Pano transition test (WASD + mouse) ===');
  await page.keyboard.press('KeyW'); // forward
  await page.waitForTimeout(120);
  await takeScreenshot(page, '03_transition_forward_001.png');
  await dumpCanvases(page, 'fwd1-during');

  await pressKeyMultiple(page, 'KeyW', 4, 220);
  await takeScreenshot(page, '03_transition_forward_005.png');
  await dumpCanvases(page, 'fwd5-after');

  // mouse drag + zoom
  log('Mouse drag + scroll zoom');
  const centerX = 960, centerY = 540;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(centerX + 180, centerY - 60, { steps: 12 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(200);
  await takeScreenshot(page, '03_mouse_drag.png');
  await page.mouse.wheel(0, -300); // zoom in
  await page.waitForTimeout(250);
  await takeScreenshot(page, '03_scroll_zoom_in.png');
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(250);
  await takeScreenshot(page, '03_scroll_zoom_out.png');

  // === 4. CRUISE MODE ===
  log('\n=== STEP 4: Cruise mode test (30s run) ===');
  await enableCruiseIfPossible(page);
  await dumpCanvases(page, 'cruise-start');
  await takeScreenshot(page, '04_cruise_start.png');

  for (let i=0; i<8; i++) {
    await page.waitForTimeout(3200);
    const snapName = `04_cruise_${String(i+1).padStart(2,'0')}.png`;
    await takeScreenshot(page, snapName);
    await dumpCanvases(page, `cruise-step-${i+1}`);
    // also log any new errors
  }
  // try to turn cruise off
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);

  // === 5. CAR MODE TOGGLE ===
  log('\n=== STEP 5: Car mode toggle test ===');
  await toggleCarMode(page);
  await takeScreenshot(page, '05_car_on_01.png');
  await dumpCanvases(page, 'car-on');
  await page.waitForTimeout(1800);
  await pressKeyMultiple(page, 'KeyW', 2, 300);
  await takeScreenshot(page, '05_car_on_moving.png');
  await toggleCarMode(page);
  await takeScreenshot(page, '05_car_off.png');
  await dumpCanvases(page, 'car-off');

  // === 6. QUALITY PRESET (best effort) ===
  log('\n=== STEP 6: Quality preset change test ===');
  await triggerQualityChange(page);
  await takeScreenshot(page, '06_quality_change_attempt.png');
  await dumpCanvases(page, 'after-quality-ui');

  // === 7. NETWORK THROTTLED "MAP API LOADING ERROR" (MOST IMPORTANT) ===
  log('\n=== STEP 7: Network-throttled test (Slow 3G + moves) ===');
  if (cdpSession) {
    try {
      // Slow 3G approx: ~50-100 kbps effective, high latency
      await cdpSession.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 1800,
        downloadThroughput: 45000,  // ~45 kB/s
        uploadThroughput: 45000,
        connectionType: 'cellular3g'
      });
      log('CDP: Emulating Slow 3G conditions');
    } catch(e){ log('Throttle set failed: '+e.message, 'WARN'); }
  } else {
    // Fallback: route handler to delay maps requests
    log('Fallback: installing slow route delays for maps traffic');
    await page.route('**/*maps*', async route => {
      await new Promise(r => setTimeout(r, 1200));
      await route.continue();
    });
    await page.route('**/*streetview*', async route => {
      await new Promise(r => setTimeout(r, 900));
      await route.continue();
    });
  }

  await page.waitForTimeout(800);
  await dumpCanvases(page, 'throttled-pre-move');
  await takeScreenshot(page, '07_throttled_pre.png');

  // Rapid moves while throttled
  log('Rapid WASD while throttled...');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('KeyW');
    await page.waitForTimeout(280);
    await takeScreenshot(page, `07_throttled_move_w${i+1}.png`);
    await dumpCanvases(page, `throttled-w${i+1}`);
  }
  await pressKeyMultiple(page, 'KeyD', 3, 350);
  await takeScreenshot(page, '07_throttled_after_d.png');

  // Now go fully offline briefly
  log('Going OFFLINE for 12s...');
  if (cdpSession) {
    await cdpSession.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  } else {
    await page.context().setOffline(true);
  }
  await page.waitForTimeout(3000);
  await takeScreenshot(page, '07_offline_3s.png');
  await dumpCanvases(page, 'offline-3s');
  await page.waitForTimeout(5000);
  await takeScreenshot(page, '07_offline_8s.png');
  await page.keyboard.press('KeyW'); // try advance while broken
  await page.waitForTimeout(2500);
  await takeScreenshot(page, '07_offline_during_attempt.png');
  await dumpCanvases(page, 'offline-during-attempt');

  // Restore
  log('Restoring network...');
  if (cdpSession) {
    await cdpSession.send('Network.emulateNetworkConditions', {
      offline: false, latency: 30, downloadThroughput: -1, uploadThroughput: -1
    });
  } else {
    await page.context().setOffline(false);
  }
  await page.waitForTimeout(1500);
  await takeScreenshot(page, '07_restored_1.png');
  await dumpCanvases(page, 'restored-1s');
  await page.waitForTimeout(4000);
  await takeScreenshot(page, '07_restored_5.png');
  await dumpCanvases(page, 'restored-5s');

  // Final baseline after chaos
  await page.waitForTimeout(3000);
  await takeScreenshot(page, '08_final_after_throttle.png');

  // One more canvas dump + any remaining logs
  await dumpCanvases(page, 'final');

  log('\n=== COLLECTING FINAL STATE ===');
  const finalCanvases = await dumpCanvases(page, 'end-of-run');
  const htmlSnippet = await page.evaluate(() => document.body.innerHTML.slice(0, 2000));
  log('Final body HTML snippet (first 800): ' + htmlSnippet.replace(/\s+/g,' ').slice(0,800));

  // Save full logs
  fs.writeFileSync(path.join(REPRO_DIR, 'full-console-log.txt'), logs.join('\n'));
  fs.writeFileSync(path.join(REPRO_DIR, 'network-events.txt'), networkEvents.join('\n'));

  log(`\n=== REPRO COMPLETE ===`);
  log(`Screenshots + logs in ${REPRO_DIR}`);
  log(`Videos in ${path.join(REPRO_DIR, 'videos')}`);

  await browser.close();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  fs.appendFileSync(LOG_FILE, 'FATAL: ' + (err.stack || err) + '\n');
  process.exit(1);
});
