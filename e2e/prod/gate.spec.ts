import { test, expect } from '@playwright/test';
import { ConsoleNetworkGate } from './gate';
import { LIVE } from './app';

/**
 * The gate is only worth having if it cannot pass vacuously. These drive a page that does each thing
 * the gate exists to catch — against a local origin, with the failures made up by `page.route` — and
 * check it is reported (and that `gate.expect` permits it, and goes stale when it does not happen).
 */
test.skip(LIVE, 'fabricated failures are provoked against a local origin only');

const BASE = 'http://gate.test/app/';

async function pageWith(page: import('@playwright/test').Page, body: string) {
  await page.route('http://gate.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/app/') return route.fulfill({ contentType: 'text/html', body });
    if (url.pathname === '/app/missing.js') return route.fulfill({ status: 404, body: 'nope' });
    if (url.pathname === '/app/masked.wasm') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' });
    if (url.pathname === '/app/dropped.js') return route.abort('connectionrefused');
    if (url.pathname === '/app/fine.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.__fine = 1;' });
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  return new ConsoleNetworkGate(page, BASE);
}

test('reports console.error, uncaught errors, failed requests, 4xx and a masqueraded asset; ignores warnings and clean assets', async ({ page }) => {
  const gate = await pageWith(
    page,
    `<!doctype html><script src="fine.js"></script><script src="missing.js"></script><script src="dropped.js"></script>
     <script>fetch('masked.wasm');console.error('boom');console.warn('just a warning');setTimeout(()=>{throw new Error('uncaught!')},0)</script>`,
  );
  await page.goto(BASE);
  await page.waitForTimeout(500);

  const report = gate.report();
  expect(report.consoleErrors.join('\n')).toContain('boom');
  expect(report.pageErrors.join('\n')).toContain('uncaught!');
  expect(report.httpErrors).toEqual([expect.stringContaining('404 GET http://gate.test/app/missing.js')]);
  expect(report.failedRequests).toEqual([expect.stringContaining('dropped.js')]);
  expect(report.htmlMasquerades).toEqual([expect.stringContaining('masked.wasm')]);
  expect(report.consoleWarnings.join('\n')).toContain('just a warning');
  expect(report.violations.some((v) => v.includes('fine.js'))).toBe(false);
  // Chromium also logs a "Failed to load resource" console.error per broken load, so a broken asset
  // is reported on more than one channel — what matters is that every kind is present.
  for (const prefix of ['console.error:', 'pageerror:', 'request failed:', 'HTTP error:', 'missing asset:']) {
    expect(report.violations.some((v) => v.startsWith(prefix)), prefix).toBe(true);
  }
});

test('gate.expect permits a provoked error, and fails the test when it never appears', async ({ page }) => {
  const gate = await pageWith(page, `<!doctype html><script>console.error('[wasm] expected failure')</script>`);
  gate.expect('console', /\[wasm\] expected failure/, 'this test breaks the wasm on purpose');
  gate.expect('request', /never-requested\.js/, 'a request the page never makes');
  await page.goto(BASE);
  await page.waitForTimeout(200);

  const report = gate.report();
  expect(report.consoleErrors).toEqual([]);
  expect(report.permitted).toEqual([expect.stringContaining('this test breaks the wasm on purpose')]);
  expect(report.violations).toEqual([expect.stringContaining('stale expectation')]);
});

test('a throttled DOCUMENT (429) is listed but not gated; a throttled asset still is', async ({ page }) => {
  await page.route('http://gate.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/app/') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="busy.js"></script>' });
    }
    return route.fulfill({ status: 429, headers: { 'retry-after': '1' }, contentType: 'text/plain', body: 'slow down' });
  });
  const gate = new ConsoleNetworkGate(page, BASE);
  await page.goto(BASE);
  await page.waitForTimeout(300);
  // The document itself answered 200 above; fetch a document-typed 429 through a navigation as well.
  await page.route('http://gate.test/doc', (route) => route.fulfill({ status: 429, headers: { 'retry-after': '1' }, body: 'slow down' }));
  await page.goto('http://gate.test/doc');

  const report = gate.report();
  expect(report.throttledDocuments).toEqual([expect.stringContaining('http://gate.test/doc')]);
  expect(report.httpErrors).toEqual([expect.stringContaining('429 GET http://gate.test/app/busy.js')]);
});
