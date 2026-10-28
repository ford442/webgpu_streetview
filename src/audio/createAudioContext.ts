/** Safari still exposes AudioContext as webkitAudioContext. */
export function createBrowserAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    window.webkitAudioContext;
  if (!Ctor) {
    throw new Error('Web Audio API is not available');
  }
  return new Ctor();
}
