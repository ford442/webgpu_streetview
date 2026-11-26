/**
 * The console / network gate of the production smoke (#384).
 *
 * One `ConsoleNetworkGate` watches one page for the whole test and turns these into failures:
 *   - any `console.error`,
 *   - any uncaught `pageerror`,
 *   - any failed request (`requestfailed`, any origin),
 *   - any 4xx/5xx response for a SAME-ORIGIN request,
 *   - any same-origin request for a file (`.js`, `.wasm`, `.wgsl`, …) answered with `text/html` — the
 *     static host's SPA fallback masquerading a missing asset as a 200 (`vite preview` does it, and so
 *     does a host whose rewrite rules are too wide).
 * Console warnings never fail a test; they are counted and listed in the report.
 *
 * Known noise is permitted only through `gateAllowlist.ts` (global, reviewed) or `gate.expect()` (one
 * test provoking an error on purpose — which fails if the message never shows up).
 */
import type { ConsoleMessage, Page, Request, Response } from '@playwright/test';
import {
  ALLOWED_CONSOLE_ERRORS,
  ALLOWED_PAGE_ERRORS,
  ALLOWED_THIRD_PARTY_FAILURES,
  type GateAllowance,
} from './gateAllowlist';

export type GateChannel = 'console' | 'pageerror' | 'request';

interface Expectation extends GateAllowance {
  readonly channel: GateChannel;
  readonly required: boolean;
  hits: number;
}

export interface GateReport {
  origin: string;
  requests: number;
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  httpErrors: string[];
  htmlMasquerades: string[];
  /** Third-party 4xx/5xx: not a failure, but listed. */
  thirdPartyHttp: string[];
  /** Document 429s the host's rate limit answered; `openApp` waits them out and fails if the retries run out. Listed, not gated. */
  throttledDocuments: string[];
  /** What the allowlist / `gate.expect` swallowed, so the report shows what was ignored. */
  permitted: string[];
  unmetExpectations: string[];
  violations: string[];
}

/** File extensions whose body is never HTML; a `text/html` answer for one is a masqueraded 404. */
const NON_HTML_FILE = /\.(?:m?js|css|wasm|wgsl|json|map|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|bin|onnx|cube|ktx2?|mp3|ogg|wav)$/i;

export class ConsoleNetworkGate {
  private readonly origin: string;
  private readonly expectations: Expectation[] = [];
  private requests = 0;
  private readonly consoleErrors: string[] = [];
  private readonly consoleWarnings: string[] = [];
  private readonly pageErrors: string[] = [];
  private readonly failedRequests: Array<{ url: string; text: string }> = [];
  /** URLs that already answered 4xx/5xx — Chromium also reports such a script/image load as `requestfailed`/ERR_ABORTED. */
  private readonly httpErrorUrls = new Set<string>();
  private readonly httpErrors: string[] = [];
  private readonly htmlMasquerades: string[] = [];
  private readonly thirdPartyHttp: string[] = [];
  private readonly throttledDocuments: string[] = [];
  private readonly permitted: string[] = [];

  constructor(page: Page, baseURL: string) {
    this.origin = new URL(baseURL).origin;
    page.on('console', (message) => this.onConsole(message));
    page.on('pageerror', (error) => this.onPageError(error));
    page.on('request', () => {
      this.requests += 1;
    });
    page.on('requestfailed', (request) => this.onRequestFailed(request));
    page.on('response', (response) => this.onResponse(response));
  }

  /**
   * This test provokes `pattern` on purpose. It is permitted on `channel`, and the test fails if it
   * never appears (unless `required: false`), so an expectation cannot outlive the behaviour it names.
   */
  expect(channel: GateChannel, pattern: RegExp, reason: string, options: { required?: boolean } = {}): void {
    this.expectations.push({ channel, pattern, reason, required: options.required ?? true, hits: 0 });
  }

  private permits(channel: GateChannel, text: string, allowlist: readonly GateAllowance[]): boolean {
    for (const entry of this.expectations) {
      if (entry.channel === channel && entry.pattern.test(text)) {
        entry.hits += 1;
        this.permitted.push(`[expected: ${entry.reason}] ${text}`);
        return true;
      }
    }
    for (const entry of allowlist) {
      if (entry.pattern.test(text)) {
        this.permitted.push(`[allowlist: ${entry.reason}] ${text}`);
        return true;
      }
    }
    return false;
  }

  private sameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === this.origin;
    } catch {
      return false;
    }
  }

  private onConsole(message: ConsoleMessage): void {
    const text = message.text();
    const where = message.location().url;
    const line = where ? `${text}  (${where})` : text;
    if (message.type() === 'warning') {
      this.consoleWarnings.push(line);
    } else if (message.type() === 'error') {
      if (!this.permits('console', text, ALLOWED_CONSOLE_ERRORS)) this.consoleErrors.push(line);
    }
  }

  private onPageError(error: Error): void {
    const text = error.stack ? `${error.message}\n${error.stack.split('\n').slice(1, 4).join('\n')}` : error.message;
    if (!this.permits('pageerror', error.message, ALLOWED_PAGE_ERRORS)) this.pageErrors.push(text);
  }

  private onRequestFailed(request: Request): void {
    const text = `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`;
    // The allowlist only ever covers third parties; a same-origin failure is always a violation
    // unless this very test expects it (a route it aborted, a 404 it served).
    const allowlist = this.sameOrigin(request.url()) ? [] : ALLOWED_THIRD_PARTY_FAILURES;
    if (!this.permits('request', text, allowlist)) this.failedRequests.push({ url: request.url(), text });
  }

  private onResponse(response: Response): void {
    const url = response.url();
    const status = response.status();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (!this.sameOrigin(url)) {
      if (status >= 400) this.thirdPartyHttp.push(`${status} ${response.request().method()} ${url}`);
      return;
    }
    if (status === 429 && response.request().resourceType() === 'document') {
      // Only the page document, and only here: `openApp` retries it and fails the test when the retries are
      // exhausted, so a 429 that is never cleared still fails. An asset's 429 stays a violation below.
      this.throttledDocuments.push(`429 ${response.request().method()} ${url}`);
      return;
    }
    if (status >= 400) {
      const text = `${status} ${response.request().method()} ${url}`;
      if (!this.permits('request', text, [])) {
        this.httpErrors.push(text);
        this.httpErrorUrls.add(url);
      }
      return;
    }
    const pathname = new URL(url).pathname;
    const contentType = response.headers()['content-type'] ?? '';
    if (status === 200 && NON_HTML_FILE.test(pathname) && /text\/html/i.test(contentType)) {
      const text = `${status} ${url} — served text/html for a file`;
      if (!this.permits('request', text, [])) this.htmlMasquerades.push(text);
    }
  }

  report(): GateReport {
    const unmetExpectations = this.expectations
      .filter((entry) => entry.required && entry.hits === 0)
      .map((entry) => `${entry.channel}: ${entry.pattern} never appeared (${entry.reason})`);
    // The same broken asset is one finding, not two.
    const failedRequests = this.failedRequests.filter((entry) => !this.httpErrorUrls.has(entry.url)).map((entry) => entry.text);
    const violations = [
      ...this.consoleErrors.map((text) => `console.error: ${text}`),
      ...this.pageErrors.map((text) => `pageerror: ${text}`),
      ...failedRequests.map((text) => `request failed: ${text}`),
      ...this.httpErrors.map((text) => `HTTP error: ${text}`),
      ...this.htmlMasquerades.map((text) => `missing asset: ${text}`),
      ...unmetExpectations.map((text) => `stale expectation: ${text}`),
    ];
    return {
      origin: this.origin,
      requests: this.requests,
      consoleErrors: [...this.consoleErrors],
      consoleWarnings: [...this.consoleWarnings],
      pageErrors: [...this.pageErrors],
      failedRequests,
      httpErrors: [...this.httpErrors],
      htmlMasquerades: [...this.htmlMasquerades],
      thirdPartyHttp: [...this.thirdPartyHttp],
      throttledDocuments: [...this.throttledDocuments],
      permitted: [...this.permitted],
      unmetExpectations,
      violations,
    };
  }
}
