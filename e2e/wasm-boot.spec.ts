import { test, expect } from '@playwright/test';

/**
 * The WASM numeric layer is the only implementation of every kernel — there is
 * no JS twin. A `.wasm` that does not load must therefore fail the app the way
 * a failed required shader does: `webgpuProbe` at stage `wasm` and the same
 * blocking WebGPU-failure overlay, in place of an app that cannot run. The
 * renderer-level report (Renderer.init awaiting the binary) is pinned on a
 * real device in gpu-foundation.spec.ts.
 */

test('a .wasm that does not load fails the boot at stage "wasm" with the blocking overlay', async ({ page }) => {
  const wasmErrors: string[] = [];
  const uncaught: string[] = [];
  page.on('pageerror', (err) => uncaught.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('[wasm]')) wasmErrors.push(msg.text());
  });
  await page.route('**/wasm/streetview-wasm.wasm', (route) => route.fulfill({ status: 404, body: 'not found' }));

  // Not gotoApp: the overlay is fixed-position, so #root itself never reads as visible.
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page.getByText(/WebGPU is required and failed to initialize.*streetview-wasm failed to load: HTTP 404/))
    .toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();

  const probe = await page.evaluate(() => ({
    ok: window.webgpuProbe?.ok,
    stage: window.webgpuProbe?.stage,
    reason: window.webgpuProbe?.reason,
  }));
  expect(probe).toEqual({ ok: false, stage: 'wasm', reason: 'streetview-wasm failed to load: HTTP 404' });
  expect(wasmErrors.length).toBeGreaterThan(0);
  expect(uncaught).toEqual([]);
});
