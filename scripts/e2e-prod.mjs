#!/usr/bin/env node
/**
 * Runs the production smoke (`e2e/prod/`, Playwright project `prod`) and writes its summary.
 *
 *   npm run test:e2e:prod                                   `vite preview` of build/ (run `npm run build` first)
 *   npm run test:e2e:prod -- --live https://test.1ink.us/streetview/ --expect-sha <40-hex>
 *   npm run test:e2e:prod -- --screens out/screens          also write the flow screenshots there
 *   npm run test:e2e:prod -- -- --grep "cabin"              everything after a bare `--` goes to Playwright
 *
 * Preview mode expects the commit named by build/build-info.json; live mode needs `--expect-sha` (or
 * E2E_EXPECT_SHA) — a deployed site is only "the app" if it says which commit it is. A key for a
 * keyless build can be handed to the page at run time with E2E_MAPS_API_KEY (never baked in).
 *
 * After the run `test-results/prod-report/SUMMARY.md` (also appended to $GITHUB_STEP_SUMMARY) lists per
 * test: result, requests, console errors / warnings, uncaught errors, failed requests — with the full
 * text of every error. That file is the "console and network results" of the State of the App report.
 * Exit code = Playwright's.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const passthroughAt = argv.indexOf('--');
const own = passthroughAt === -1 ? argv : argv.slice(0, passthroughAt);
const playwrightArgs = passthroughAt === -1 ? [] : argv.slice(passthroughAt + 1);
/** @param {string} name */
const value = (name) => (own.includes(name) ? own[own.indexOf(name) + 1] : undefined);

const reportDir = path.join(root, 'test-results', 'prod-report');
for (const option of ['--live', '--expect-sha', '--screens']) {
  if (own.includes(option) && (own[own.indexOf(option) + 1] ?? '').startsWith('--')) {
    console.error(`e2e-prod: ${option} needs a value.`);
    process.exit(2);
  }
  if (own.includes(option) && own.indexOf(option) === own.length - 1) {
    console.error(`e2e-prod: ${option} needs a value.`);
    process.exit(2);
  }
}
const live = value('--live');
const expectSha = value('--expect-sha') ?? process.env.E2E_EXPECT_SHA;
const screens = value('--screens');

if (live && !/^[0-9a-f]{40}$/.test(expectSha ?? '')) {
  console.error('e2e-prod: --live needs --expect-sha <40-hex> (or E2E_EXPECT_SHA): the site must be proven to be this commit.');
  process.exit(2);
}
if (!live && !fs.existsSync(path.join(root, 'build', 'index.html'))) {
  console.error('e2e-prod: build/ does not exist — run `npm run build` first (this suite tests the production bundle, not the dev server).');
  process.exit(2);
}

fs.rmSync(reportDir, { recursive: true, force: true });
fs.mkdirSync(reportDir, { recursive: true });

const env = {
  ...process.env,
  E2E_PROD: '1',
  PLAYWRIGHT_HTML_OPEN: 'never',
  PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(reportDir, 'playwright.json'),
  ...(live ? { E2E_BASE_URL: live } : {}),
  ...(expectSha ? { E2E_EXPECT_SHA: expectSha } : {}),
  ...(screens ? { E2E_SCREENSHOT_DIR: path.resolve(root, screens) } : {}),
};
const run = spawnSync('npx', ['playwright', 'test', '--project=prod', '--reporter=list,html,json', ...playwrightArgs], {
  cwd: root,
  env,
  stdio: 'inherit',
});

/** @typedef {{ title: string, retry?: number, throttledDocuments?: string[], status: string, expectedStatus?: string, requests: number, consoleErrors: string[], consoleWarnings: string[], pageErrors: string[], failedRequests: string[], httpErrors: string[], htmlMasquerades: string[], thirdPartyHttp: string[], permitted: string[], unmetExpectations: string[], violations: string[] }} GateEntry */

/** @type {GateEntry[]} */
const entries = fs
  .readdirSync(reportDir)
  .filter((name) => name.endsWith('.json') && name !== 'playwright.json')
  .map((name) => JSON.parse(fs.readFileSync(path.join(reportDir, name), 'utf8')))
  .sort((a, b) => a.title.localeCompare(b.title));

/** @param {(entry: GateEntry) => number} pick */
const sum = (pick) => entries.reduce((total, entry) => total + pick(entry), 0);

/** @type {{ expected?: number, unexpected?: number, skipped?: number, flaky?: number } | null} */
let stats = null;
try {
  stats = JSON.parse(fs.readFileSync(path.join(reportDir, 'playwright.json'), 'utf8')).stats;
} catch {
  /* Playwright died before it wrote a report; the table below still has the gate data */
}

const lines = [];
lines.push(`## Production smoke — ${live ?? 'vite preview of build/'}`);
lines.push('');
if (expectSha) lines.push(`Expected commit: \`${expectSha}\``);
if (stats) {
  lines.push(`Playwright: **${stats.expected ?? 0} passed**, ${stats.unexpected ?? 0} failed, ${stats.skipped ?? 0} skipped, ${stats.flaky ?? 0} flaky.`);
}
lines.push(
  `Console / network gate over ${entries.length} test(s): **${sum((e) => e.consoleErrors.length)} console errors**, ` +
    `${sum((e) => e.consoleWarnings.length)} warnings, ${sum((e) => e.pageErrors.length)} uncaught errors, ` +
    `**${sum((e) => e.failedRequests.length + e.httpErrors.length + e.htmlMasquerades.length)} failed same-origin / failed requests**, ` +
    `${sum((e) => e.thirdPartyHttp.length)} third-party 4xx/5xx (not gated), ${sum((e) => e.permitted.length)} permitted by allowlist / expectation.`,
);
lines.push('');
lines.push('| Test | Result | Requests | Errors | Warnings | Uncaught | Failed requests |');
lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
for (const e of entries) {
  const failed = e.failedRequests.length + e.httpErrors.length + e.htmlMasquerades.length;
  const result = e.status === 'failed' && e.expectedStatus === 'failed' ? 'known defect (expected failure)' : e.status;
  const name = `${e.title}${e.retry ? ` (retry ${e.retry})` : ''}`;
  lines.push(`| ${name.replace(/\|/g, '\\|')} | ${result} | ${e.requests} | ${e.consoleErrors.length} | ${e.consoleWarnings.length} | ${e.pageErrors.length} | ${failed} |`);
}
const detail = entries.filter((e) => e.violations.length || e.consoleWarnings.length || e.permitted.length || e.thirdPartyHttp.length || e.throttledDocuments?.length);
if (detail.length) {
  lines.push('', '### Full text', '');
  for (const e of detail) {
    lines.push(`<details><summary>${e.title}</summary>`, '', '```text');
    for (const v of e.violations) lines.push(`VIOLATION  ${v}`);
    for (const w of e.consoleWarnings) lines.push(`warning    ${w}`);
    for (const t of e.thirdPartyHttp) lines.push(`third-party ${t}`);
    for (const t of e.throttledDocuments ?? []) lines.push(`throttled  ${t}`);
    for (const p of e.permitted) lines.push(`permitted  ${p}`);
    lines.push('```', '', '</details>', '');
  }
}
const summary = `${lines.join('\n')}\n`;
fs.writeFileSync(path.join(reportDir, 'SUMMARY.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(`\n${lines.slice(0, 7).join('\n')}\n(full summary: ${path.relative(root, path.join(reportDir, 'SUMMARY.md'))})`);

process.exit(run.status ?? 1);
