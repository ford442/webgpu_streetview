// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserAudioContext } from './createAudioContext';

describe('createBrowserAudioContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'AudioContext');
  });

  it('asks for interactive latency at 48 kHz', () => {
    const ctor = vi.fn();
    window.AudioContext = ctor as unknown as typeof AudioContext;
    createBrowserAudioContext();
    expect(ctor).toHaveBeenCalledWith({ latencyHint: 'interactive', sampleRate: 48000 });
  });

  it('retries without options when the browser refuses them', () => {
    const ctor = vi.fn(function (this: unknown, options?: unknown) {
      if (options) throw new DOMException('unsupported sample rate', 'NotSupportedError');
    });
    window.AudioContext = ctor as unknown as typeof AudioContext;
    expect(() => createBrowserAudioContext()).not.toThrow();
    expect(ctor).toHaveBeenCalledTimes(2);
  });
});
