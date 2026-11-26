/**
 * `test` for the production smoke: Playwright's, plus an automatic `gate` fixture that watches the
 * page for console errors / failed requests (`gate.ts`) and fails the test on teardown when it saw
 * any. Every run also writes its report to `test-results/prod-report/` — `scripts/e2e-prod.mjs`
 * folds those into the State of the App summary (error / warning counts, full text, failed requests).
 */
import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { ConsoleNetworkGate } from './gate';

export const REPORT_DIR = path.join(process.cwd(), 'test-results', 'prod-report');

export const test = base.extend<{ gate: ConsoleNetworkGate }>({
  gate: [
    async ({ page, baseURL }, use, testInfo) => {
      const gate = new ConsoleNetworkGate(page, baseURL ?? 'http://127.0.0.1:4173/streetview/');
      await use(gate);

      const report = gate.report();
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const slug = testInfo.titlePath.join(' › ').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 120);
      const body = JSON.stringify({ title: testInfo.titlePath.join(' › '), file: testInfo.file, status: testInfo.status, expectedStatus: testInfo.expectedStatus, ...report }, null, 2);
      fs.writeFileSync(path.join(REPORT_DIR, `${slug}.json`), body);
      await testInfo.attach('console-network-report', { body, contentType: 'application/json' });

      expect(report.violations, 'console / network gate').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
