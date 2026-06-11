const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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
  try { fs.appendFileSync(LOG_FILE, entry + '\n'); } catch(e){}
}

async function dumpCanvases(page, label) {
  const info = await page.evaluate((lbl) => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const results = canvases.map((c, i) => {
      const rect = c.getBoundingClientRect();
      const style = window.getComputedStyle(c);
      let sample = 'no-ctx';
      try {
        const ctx2d = c.getContext('2d', { willReadFrequently: true });
        if (ctx2d && c.width && c.height) {
          const d = ctx2d.getImageData(Math.min(8, c.width-1)|0, Math.min(8, c.height-1)|0, 1, 1);
          sample = `px(${d.data[0]},${d.data[1]},${d.data[2]})`;
        } else {
          const gl = c.getContext('webgl') || c.getContext('webgl2');
          sample = gl ? 'webgl-ctx' : 'no-sampleable-ctx';
        }
      } catch(e) { sample = 'tainted:' + String(e.message).slice(0,60); }
      return {
        index: i,
        w: c.width, h: c.height,
        cw: c.clientWidth, ch: c.clientHeight,
        rect: {x: Math.round(rect.x), y: Math.round(rect.y), rw: Math.round(rect.width), rh: Math.round(rect.height)},
        z: style.zIndex, op: style.opacity, vis: style.visibility, disp: style.display, pos: style.position, pe: style.pointerEvents,
        id: c.id || '', cls: (c.className || '').slice(0,60),
        parent: c.parentElement ? ((c.parentElement.id || '') + ' ' + (c.parentElement.className || '')).trim().slice(0,50) : 'none',
        sample
      };
    });
    const gm = Array.from(document.querySelectorAll('.gm-style, [class*="gm-"], .gm-err-container, div[style*="Google"]')).slice(0,6).map(el => {
      const s = window.getComputedStyle(el);
      return { cls: el.className.slice(0,40), z:s.zIndex, op:s.opacity, disp:s.display, txt:(el.textContent||'').replace(/\s+/g,' ').slice(0,80) };
    });
    return { label: lbl, total: canvases.length, big: results.filter(r=>r.w>200||r.h>200), gm };
  }, label).catch(() => ({label, total:0, big:[], gm:[]}));
  log(`CANVASES[${label}]: ${info.total} total, ${info.big.length} big. GM elems:${info.gm.length}`, 'DEBUG');
  info.big.forEach((c,i) => log(`  C${i}: ${c.w}x${c.h} z=${c.z} op=${c.op} vis=${c.vis} id="${c.id}" cls="${c.cls}" parent~"${c.parent}" sample~${c.sample}`, 'DEBUG'));
  if (info.gm.length) info.gm.forEach(g => log(`  GM: ${g.cls} z=${g.z} op=${g.op} disp=${g.disp} txt~${g.txt}`, 'DEBUG'));
  return info;
}

async function snap(page, name) {
  const fp = path.join(REPRO_DIR, name);
  await page.screenshot({ path: fp, fullPage: false }).catch(()=>{});
  log(`SHOT: ${name}`);
  return fp;
}

async function main() {
  fs.mkdirSync(REPRO_DIR, { recursive: true });
  try { fs.unlinkSync(LOG_FILE); } catch(e){}
  log('=== FLICKER REPRO START (CJS via playwright node) ===');
  log('Target: ' + TARGET_URL);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--use-gl=egl','--use-angle=gl-egl',
      '--enable-features=Vulkan,WebGPU',
      '--enable-unsafe-webgpu','--ignore-gpu-blocklist',
      '--enable-gpu-rasterization','--enable-zero-copy',
      '--disable-software-rasterizer','--disable-dev-shm-usage'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1.25,
    recordVideo: { dir: path.join(REPRO_DIR, 'videos'), size: {width:1920, height:1080} },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  page.on('console', m => {
    const t = `[CONSOLE ${m.type().toUpperCase()}] ${m.text()}`;
    logs.push(t);
    if (/gm_|canvas|webgpu|webgl|device lost|copyExternal|StreetView|auth|Maps API|error/i.test(m.text()) || m.type()==='error') {
      console.log(t); fs.appendFileSync(LOG_FILE, t+'\n');
    }
  });
  page.on('pageerror', e => { const t=`[PAGEERROR] ${e.message}`; logs.push(t); console.log(t); fs.appendFileSync(LOG_FILE,t+'\n'); });
  page.on('requestfailed', r => {
    const u = r.url(); if (/google|maps|streetview|tiles/i.test(u)) { const t=`[NET-FAIL] ${r.method()} ${u} :: ${r.failure()?.errorText}`; networkEvents.push(t); log(t,'NET'); }
  });

  let cdp = null;
  try { cdp = await context.newCDPSession(page); log('CDP acquired for throttling'); } catch(e){ log('No CDP: '+e.message,'WARN'); }

  // === GOTO + DISMISS ===
  log('GOTO live site...');
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 65000 });
  await page.waitForTimeout(2800);
  await dumpCanvases(page, 'post-goto');

  // Dismiss welcome
  let dismissed = false;
  for (const sel of ['button:has-text("Start Exploring")', 'button:has-text("Start")', 'text="Start Exploring"']) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({timeout:2500}).catch(()=>false)) { await b.click({timeout:4000}); log('Dismissed via '+sel); dismissed=true; break; }
    } catch(e){}
  }
  if (!dismissed) { await page.keyboard.press('Escape'); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(2200);

  await page.keyboard.press('KeyP').catch(()=>{}); // perf overlay
  await page.waitForTimeout(600);
  await dumpCanvases(page, 'after-dismiss-p');
  await snap(page, '01_idle_baseline.png');

  log('IDLE 28s baseline...');
  await page.waitForTimeout(14000);
  await dumpCanvases(page, 'idle-14s');
  await snap(page, '01b_idle_mid.png');
  await page.waitForTimeout(14000);
  await dumpCanvases(page, 'idle-28s');
  await snap(page, '01c_idle_28s.png');

  // === RELOAD / INITIAL LOAD FLICKER ===
  log('\n=== RELOAD for initial-load flicker ===');
  await page.evaluate(()=>{try{performance.clearResourceTimings();}catch(e){}});
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.waitForTimeout(1600);
  // try dismiss again
  try { await page.locator('button:has-text("Start")').first().click({timeout:2500}); } catch(e){ await page.keyboard.press('Escape'); }
  await page.waitForTimeout(2200);
  await dumpCanvases(page, 'reload-4s');
  await snap(page, '02_reload_4s.png');

  for (let i=0; i<5; i++) {
    await page.waitForTimeout(1600);
    await dumpCanvases(page, `reload-t${(i+1)*1.6}s`);
    await snap(page, `02_reload_t${String(i+1).padStart(2,'0')}.png`);
  }

  // === TRANSITIONS ===
  log('\n=== Pano transitions (WASD + mouse) ===');
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(90);
  await snap(page, '03_trans_w1.png');
  await dumpCanvases(page, 'trans-w1');
  await page.keyboard.press('KeyW'); await page.waitForTimeout(160); await snap(page, '03_trans_w2.png');
  await page.keyboard.press('KeyW'); await page.waitForTimeout(160); await snap(page, '03_trans_w3.png');
  await page.keyboard.press('KeyW'); await page.waitForTimeout(160); await snap(page, '03_trans_w4.png');
  await dumpCanvases(page, 'trans-w4');

  // mouse look + zoom
  const cx=960, cy=520;
  await page.mouse.move(cx,cy); await page.mouse.down({button:'left'});
  await page.mouse.move(cx+220, cy-90, {steps:10}); await page.mouse.up({button:'left'});
  await page.waitForTimeout(160); await snap(page, '03_mouse_drag.png');
  await page.mouse.wheel(0, -280); await page.waitForTimeout(180); await snap(page, '03_zoom_in.png');
  await page.mouse.wheel(0, 380); await page.waitForTimeout(180); await snap(page, '03_zoom_out.png');

  // === CRUISE (best effort) ===
  log('\n=== Cruise mode (try enable + run) ===');
  await page.keyboard.press('KeyC'); await page.waitForTimeout(280);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(280); // toggle may be car/cruise
  await dumpCanvases(page, 'cruise-attempt');
  await snap(page, '04_cruise_try.png');
  for (let i=0; i<6; i++) {
    await page.waitForTimeout(2600);
    await snap(page, `04_cruise_${String(i+1).padStart(2,'0')}.png`);
    await dumpCanvases(page, `cruise-${i+1}`);
  }
  await page.keyboard.press('KeyC').catch(()=>{}); // attempt off

  // === CAR MODE ===
  log('\n=== Car mode toggles ===');
  await page.keyboard.press('KeyC'); await page.waitForTimeout(650);
  await snap(page, '05_car_on.png'); await dumpCanvases(page, 'car-on');
  await page.keyboard.press('KeyW'); await page.waitForTimeout(220);
  await snap(page, '05_car_moving.png');
  await page.keyboard.press('KeyC'); await page.waitForTimeout(650);
  await snap(page, '05_car_off.png'); await dumpCanvases(page, 'car-off');

  // === QUALITY (UI attempt) ===
  log('\n=== Quality change attempt ===');
  await page.keyboard.press('KeyS').catch(()=>{}); await page.waitForTimeout(350);
  try { await page.locator('button:has-text("Low")').first().click({timeout:1200}); } catch(e){}
  await page.waitForTimeout(400);
  await snap(page, '06_quality_low_attempt.png');
  await page.keyboard.press('Escape').catch(()=>{});
  await page.waitForTimeout(600);

  // === NETWORK THROTTLE (KEY TEST) ===
  log('\n=== NETWORK THROTTLE + MOVES (Slow 3G / offline) ===');
  if (cdp) {
    try {
      await cdp.send('Network.emulateNetworkConditions', {offline:false, latency:1600, downloadThroughput:42000, uploadThroughput:42000});
      log('CDP Slow3G engaged');
    } catch(e){ log('CDP throttle err: '+e.message,'WARN'); }
  }
  await page.waitForTimeout(700);
  await dumpCanvases(page, 'throt-pre');
  await snap(page, '07_throt_pre.png');

  log('Rapid moves under throttle...');
  for (let i=0; i<4; i++) {
    await page.keyboard.press('KeyW'); await page.waitForTimeout(240);
    await snap(page, `07_throt_w${i+1}.png`);
    await dumpCanvases(page, `throt-w${i+1}`);
  }

  // Offline burst
  log('OFFLINE 10s...');
  if (cdp) {
    await cdp.send('Network.emulateNetworkConditions', {offline:true, latency:0, downloadThroughput:0, uploadThroughput:0});
  } else {
    await context.setOffline(true);
  }
  await page.waitForTimeout(2200);
  await snap(page, '07_offline_2s.png'); await dumpCanvases(page, 'offline-2');
  await page.keyboard.press('KeyW'); await page.waitForTimeout(1800);
  await snap(page, '07_offline_during_nav.png'); await dumpCanvases(page, 'offline-nav');
  await page.waitForTimeout(4500);
  await snap(page, '07_offline_9s.png');

  // Restore
  log('RESTORE network');
  if (cdp) {
    await cdp.send('Network.emulateNetworkConditions', {offline:false, latency:40, downloadThroughput:-1, uploadThroughput:-1});
  } else {
    await context.setOffline(false);
  }
  await page.waitForTimeout(1400);
  await snap(page, '07_restore_1s.png'); await dumpCanvases(page, 'restore-1');
  await page.waitForTimeout(3500);
  await snap(page, '07_restore_5s.png'); await dumpCanvases(page, 'restore-5');
  await snap(page, '08_final.png');

  // Final state
  await dumpCanvases(page, 'FINAL');
  const bodyText = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,600)).catch(()=>'');
  log('Final visible text sample: ' + bodyText);

  // Persist artifacts
  fs.writeFileSync(path.join(REPRO_DIR, 'full-logs.txt'), logs.join('\n'));
  fs.writeFileSync(path.join(REPRO_DIR, 'network.txt'), networkEvents.join('\n'));

  log('=== COMPLETE. Artifacts in ' + REPRO_DIR);
  await browser.close();
}

main().catch(e => { console.error('FATAL', e); try{fs.appendFileSync(LOG_FILE, 'FATAL '+ (e.stack||e)+'\n');}catch(_){} process.exit(1); });
