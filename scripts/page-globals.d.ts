// Ambient types for `window` properties the probe scripts read inside page.evaluate().
// (Probe scripts run in Node but evaluate callbacks in the browser.)
interface Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __out?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __mapsKeyProbe?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __STREETVIEW_PROBE__?: any;
  MAPS_API_KEY?: string;
  usingWebGPU?: boolean;
}
