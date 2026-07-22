import { test, expect } from '@playwright/test';
import { dismissWelcome, gotoApp } from './helpers';

test.describe('offline shell registration', () => {
  test('service-worker.js is reachable and registration is attempted on localhost', async ({
    page,
  }) => {
    const swResponses: number[] = [];
    page.on('response', (res) => {
      if (res.url().includes('service-worker.js')) {
        swResponses.push(res.status());
      }
    });

    await gotoApp(page);
    await dismissWelcome(page);

    // public/service-worker.js must be served for the offline shell.
    const sw = await page.request.get('/service-worker.js');
    expect(sw.ok()).toBeTruthy();
    const body = await sw.text();
    expect(body).toMatch(/streetview-v1|STATIC_CACHE|Never caches Google/i);

    // On localhost the app fetches then registers the SW (see serviceWorkerRegistration.ts).
    await expect
      .poll(async () => {
        if (swResponses.some((s) => s >= 200 && s < 400)) return true;
        return page.evaluate(async () => {
          if (!('serviceWorker' in navigator)) return false;
          const regs = await navigator.serviceWorker.getRegistrations();
          return regs.length > 0;
        });
      }, { timeout: 20_000 })
      .toBe(true);
  });
});
