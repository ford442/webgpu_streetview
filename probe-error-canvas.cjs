const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const OUT = '/content/webgpu_streetview/repro-screenshots/probe-';
const LOG = '/content/webgpu_streetview/repro-screenshots/probe-log.txt';
const URL = 'https://test.1ink.us/streetview/index.html';
function lg(m){ const e=`[${new Date().toISOString()}] ${m}`; console.log(e); fs.appendFileSync(LOG,e+'\n'); }
(async () => {
  fs.mkdirSync(path.dirname(OUT), {recursive:true}); try{fs.unlinkSync(LOG);}catch(e){}
  lg('PROBE: forcing bad key to exercise GM load + auth fail + canvas creation paths');
  const b = await chromium.launch({headless:true, args:['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-webgpu','--use-gl=egl']});
  const ctx = await b.newContext({viewport:{width:1280,height:720}, deviceScaleFactor:1});
  const p = await ctx.newPage();
  p.on('console', m => { if (/gm_|StreetView|Maps|canvas|auth|key|error/i.test(m.text())) lg('[CONSOLE] '+m.text()); });
  // Force a bad-but-plausible key *before* any bundle code runs
  await p.addInitScript(() => {
    window.MAPS_API_KEY = 'AIzaSyD3V3RY1nV3ry1nV3ry1nV3ry1nV3ry1nV3ry1n'; // will fail referrer/auth
    // Also patch early guard if present
    try { Object.defineProperty(window, '__DEBUG_FORCE_KEY', {value: true}); } catch(e){}
  });
  await p.goto(URL, {waitUntil:'domcontentloaded', timeout:45000});
  await p.waitForTimeout(2500);
  // Dismiss if present
  try { await p.locator('button:has-text("Start")').first().click({timeout:2000}); } catch(e){ await p.keyboard.press('Escape'); }
  await p.waitForTimeout(1800);
  // Now dump everything
  const state = await p.evaluate(() => {
    const cans = Array.from(document.querySelectorAll('canvas')).map((c,i)=>({i, w:c.width,h:c.height, z: getComputedStyle(c).zIndex, op:getComputedStyle(c).opacity, id:c.id, cls:c.className, parent: c.parentElement?.className?.slice(0,30) }));
    const gms = Array.from(document.querySelectorAll('.gm-style, .gm-err-container, [class*="gm-"], div[aria-label*="Google"]')).map(el=>({cls:el.className.slice(0,40), txt:(el.textContent||'').slice(0,100).replace(/\s+/g,' '), z:getComputedStyle(el).zIndex, vis:getComputedStyle(el).display }));
    const panoDiv = document.querySelector('div[style*="pointer-events: none"]') || document.querySelector('.gm-style') || null;
    return { canvasCount: cans.length, canvases: cans, gmCount: gms.length, gms, hasPano: !!panoDiv, bodyClasses: document.body.className, hasErrorDialog: !!document.querySelector('[role="alertdialog"]') };
  });
  lg('STATE: ' + JSON.stringify(state, null, 0));
  await p.screenshot({path: OUT + 'error-state.png'});
  // Try to trigger some pano activity (even if will fail)
  await p.keyboard.press('KeyW'); await p.waitForTimeout(400);
  await p.screenshot({path: OUT + 'error-after-w.png'});
  const state2 = await p.evaluate(() => {
    const cans = Array.from(document.querySelectorAll('canvas')).map((c,i)=>({i,w:c.width,h:c.height,z:getComputedStyle(c).zIndex}));
    const errs = Array.from(document.querySelectorAll('.gm-err-container, [class*="error"], [aria-label*="load"]')).map(e=>(e.textContent||'').slice(0,80));
    return {cans, errs};
  });
  lg('STATE2 after input: ' + JSON.stringify(state2));
  await p.screenshot({path: OUT + 'error-final.png'});
  fs.writeFileSync(OUT + 'state.json', JSON.stringify({state, state2}, null, 2));
  lg('Probe complete. Screenshots: ' + OUT + '*.png');
  await b.close();
})();
