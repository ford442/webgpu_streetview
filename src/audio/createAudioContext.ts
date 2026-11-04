/** Safari still exposes AudioContext as webkitAudioContext. */
export function createBrowserAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    window.webkitAudioContext;
  if (!Ctor) {
    throw new Error('Web Audio API is not available');
  }
  try {
    // 'interactive' keeps the output buffer small (engine/wind react to input);
    // 48 kHz is the rate the cabin DSP's IRs and HRTFs are authored for, so a
    // 44.1 kHz device is resampled once by the browser, not per node.
    return new Ctor({ latencyHint: 'interactive', sampleRate: 48000 });
  } catch {
    // A browser that refuses the options (unsupported rate) still gets a context.
    return new Ctor();
  }
}
