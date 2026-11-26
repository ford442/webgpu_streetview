/**
 * The reviewed allowlist for the production smoke's console / network gate (#384).
 *
 * The gate (`gate.ts`) fails a test on any `console.error`, uncaught `pageerror`, failed request or
 * 4xx/5xx for a same-origin asset. An entry here silences ONE known source of third-party noise for
 * every test. Keep it short: each entry is something the app does not control and cannot fix, seen in
 * a real run, with the reason written down and the run it was seen in. Our own errors are never
 * listed here — fix them. An empty list is the goal; do not add an entry "just in case".
 *
 * A test that provokes an error on purpose (a missing wasm, an invalid key, no WebGPU) does not add
 * to this file: it calls `gate.expect(...)` in the spec, which both permits the message and FAILS the
 * test if the message never appeared (so the expectation cannot go stale).
 */

export interface GateAllowance {
  /** What the entry silences and where it was seen, for the reviewer. */
  readonly reason: string;
  /** Matches the console text / page error message / failed or failing URL, depending on the list. */
  readonly pattern: RegExp;
}

/** `console.error` messages that are not ours. */
export const ALLOWED_CONSOLE_ERRORS: readonly GateAllowance[] = [];

/** Uncaught page errors that originate in Google's Maps code, not ours. */
export const ALLOWED_PAGE_ERRORS: readonly GateAllowance[] = [];

/**
 * Third-party request failures (a `requestfailed`, or 4xx/5xx from a non-same-origin host). Matched
 * against `METHOD url — reason`. Same-origin failures are never allowlisted: an asset of ours that
 * does not load is exactly what the gate is for.
 */
export const ALLOWED_THIRD_PARTY_FAILURES: readonly GateAllowance[] = [];
