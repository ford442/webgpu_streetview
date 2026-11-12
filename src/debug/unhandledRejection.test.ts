// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  getUnhandledErrors,
  installUnhandledRejectionCounter,
  resetUnhandledErrorsForTests,
} from './unhandledRejection';

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  resetUnhandledErrorsForTests();
});

function rejectionEvent(reason: unknown): Event {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason });
  return event;
}

describe('installUnhandledRejectionCounter', () => {
  it('counts rejections and errors and keeps the last message', () => {
    uninstall = installUnhandledRejectionCounter(window);
    window.dispatchEvent(rejectionEvent(new TypeError('nope')));
    window.dispatchEvent(rejectionEvent('plain'));
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('thrown'), message: 'thrown' }));
    expect(getUnhandledErrors()).toEqual({ rejections: 2, errors: 1, last: 'Error: thrown' });
  });

  it('installs once', () => {
    uninstall = installUnhandledRejectionCounter(window);
    const second = installUnhandledRejectionCounter(window);
    window.dispatchEvent(rejectionEvent('x'));
    second();
    expect(getUnhandledErrors().rejections).toBe(1);
  });

  it('truncates a long reason', () => {
    uninstall = installUnhandledRejectionCounter(window);
    window.dispatchEvent(rejectionEvent('x'.repeat(500)));
    expect(getUnhandledErrors().last?.length).toBe(201);
  });
});
