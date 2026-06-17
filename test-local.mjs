import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=egl',
    '--use-angle=gl-egl',
    '--enable-features=Vulkan',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--disable-software-rasterizer',
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ]
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 }
});
const page = await context.newPage();

const logs = [];
page.on('console', msg => {
  const entry = `[${msg.type().toUpperCase()}] ${msg.text()}`;
  logs.push(entry);
  console.log(entry);
});
page.on('pageerror', err => {
  const entry = `[PAGEERROR] ${err.message}`;
  logs.push(entry);
  console.log(entry);
});
page.on('requestfailed', req => {
  const entry = `[REQUESTFAILED] ${req.url()} — ${req.failure()?.errorText}`;
  logs.push(entry);
  console.log(entry);
});

await page.goto('http://test.1ink.us', { waitUntil: 'networkidle', timeout: 60000 });
console.log('Page loaded, waiting 20s for Google Maps...');
await page.waitForTimeout(20000);

const hasMapError = logs.some(l =>
  l.toLowerCase().includes("can't load google maps") ||
  l.toLowerCase().includes("cannot load google maps") ||
  l.toLowerCase().includes("failed to load google maps") ||
  l.toLowerCase().includes("google maps api error") ||
  l.toLowerCase().includes("invalidkeymaperror") ||
  l.toLowerCase().includes("referernotallowedmaperror") ||
  l.toLowerCase().includes("gm_authfailure")
);

console.log('\n=== SUMMARY BEFORE CLICK ===');
console.log('Has Google Maps error:', hasMapError);

await page.screenshot({ path: '/content/webgpu_streetview/test-screenshot-1.png', fullPage: true });
console.log('Screenshot 1 saved (with modal)');

// Click "Start Exploring" to dismiss welcome modal
const startBtn = await page.$('button:has-text("Start Exploring")');
if (startBtn) {
  await startBtn.click();
  console.log('Clicked Start Exploring');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/content/webgpu_streetview/test-screenshot-2.png', fullPage: true });
  console.log('Screenshot 2 saved (after dismiss)');
} else {
  console.log('Start Exploring button not found');
}

const bodyText = await page.evaluate(() => document.body.innerText);
console.log('\n=== BODY TEXT (first 500 chars) ===');
console.log(bodyText.slice(0, 500));

await browser.close();

if (hasMapError) {
  console.log('\n❌ FAILED: Google Maps error detected');
  process.exit(1);
} else {
  console.log('\n✅ SUCCESS: No Google Maps error detected');
}
