/** Safari still exposes AudioContext as webkitAudioContext. */
type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export function createBrowserAudioContext(): AudioContext {
  const win = window as WindowWithWebkitAudio;
  const Ctor = win.AudioContext ?? win.webkitAudioContext;
  if (!Ctor) {
    throw new Error('Web Audio API is not available');
  }
  return new Ctor();
}
