/**
 * Where the page is served from, for same-origin assets (shaders, wasm, models,
 * the service worker). Vite's `base` is './' so a subpath deploy needs no rebuild:
 * this is '.' there, and '' when the app is served from the origin root. Join with
 * `${PUBLIC_URL}/path` — the result is never protocol-relative.
 */
export const PUBLIC_URL: string =
  import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '');
