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
      // One file per attempt (retry / repeat), so a retry that passes cannot overwrite the attempt that failed.
      const slug = `${testInfo.titlePath.join(' › ').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 110)}.r${testInfo.retry}.x${testInfo.repeatEachIndex}`;
      // The gate's verdict is part of the result: a body that passed but tripped the gate is a failure.
      const status = report.violations.length > 0 && testInfo.status === 'passed' ? 'failed' : testInfo.status;
      const body = JSON.stringify(
        { title: testInfo.titlePath.join(' › '), testId: testInfo.testId, retry: testInfo.retry, repeatEachIndex: testInfo.repeatEachIndex, file: testInfo.file, status, expectedStatus: testInfo.expectedStatus, ...report },
        null,
        2,
      );
      fs.writeFileSync(path.join(REPORT_DIR, `${slug}.json`), body);
      await testInfo.attach('console-network-report', { body, contentType: 'application/json' });

      expect(report.violations, 'console / network gate').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
