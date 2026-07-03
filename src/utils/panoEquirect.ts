/**
 * panoEquirect.ts
 *
 * Builds a small equirectangular image of a Street View panorama for use as
 * an image-based-lighting (IBL) environment map in the car interior.
 *
 * Tiles come from the official `StreetViewTileData.getTileUrl` surface of the
 * already-loaded Maps JS API. A low tile zoom is used on purpose: the result
 * is prefiltered (blurred) by PMREM anyway, so 512×256 is plenty and keeps
 * bandwidth negligible on every pano hop.
 *
 * Results are cached per pano id; failures (CORS, network, missing tile data)
 * resolve to `null` so callers can keep the previous environment.
 */

export interface PanoEquirect {
  /** 2:1 equirectangular canvas, image centre = `centerHeading`. */
  canvas: HTMLCanvasElement;
  /** Compass heading (degrees) at the horizontal centre of the image. */
  centerHeading: number;
}

const OUT_WIDTH = 512;
const OUT_HEIGHT = 256;
/** Tile zoom used for the environment. 1 → ~1024×512 source, 1-2 tiles. */
const ENV_TILE_ZOOM = 1;
const CACHE_LIMIT = 24;

const cache = new Map<string, PanoEquirect>();
const inFlight = new Map<string, Promise<PanoEquirect | null>>();

let svService: google.maps.StreetViewService | null = null;

function getSvService(): google.maps.StreetViewService | null {
  if (typeof google === 'undefined' || !google.maps) return null;
  if (!svService) svService = new google.maps.StreetViewService();
  return svService;
}

function fetchTileData(panoId: string): Promise<google.maps.StreetViewTileData | null> {
  const sv = getSvService();
  if (!sv) return Promise.resolve(null);
  return new Promise((resolve) => {
    sv.getPanorama({ pano: panoId }, (data, status) => {
      if (status === google.maps.StreetViewStatus.OK && data?.tiles) {
        resolve(data.tiles);
      } else {
        resolve(null);
      }
    });
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile load failed: ${url}`));
    img.src = url;
  });
}

async function buildEquirect(panoId: string): Promise<PanoEquirect | null> {
  const tiles = await fetchTileData(panoId);
  if (!tiles || typeof tiles.getTileUrl !== 'function') return null;

  const tileW = tiles.tileSize?.width ?? 512;
  const tileH = tiles.tileSize?.height ?? 512;
  const worldW = tiles.worldSize?.width ?? 0;
  const worldH = tiles.worldSize?.height ?? 0;
  if (worldW <= 0 || worldH <= 0) return null;

  // `worldSize` is the pano's dimensions at max zoom; each zoom step halves it.
  // Old-generation panos are 416-based (not a power-of-two multiple of the
  // tile size), so tiles can carry padding on the right/bottom edges — the
  // content region is cropped out below.
  const maxZoom = Math.max(0, Math.round(Math.log2(worldW / tileW)));
  const zoom = Math.min(ENV_TILE_ZOOM, maxZoom);
  const contentW = Math.round(worldW / Math.pow(2, maxZoom - zoom));
  const contentH = Math.round(worldH / Math.pow(2, maxZoom - zoom));
  const tilesX = Math.max(1, Math.ceil(contentW / tileW));
  const tilesY = Math.max(1, Math.ceil(contentH / tileH));

  const loads: Promise<{ img: HTMLImageElement; x: number; y: number }>[] = [];
  for (let y = 0; y < tilesY; y++) {
    for (let x = 0; x < tilesX; x++) {
      const url = tiles.getTileUrl(panoId, zoom, x, y);
      loads.push(loadImage(url).then((img) => ({ img, x, y })));
    }
  }
  const loaded = await Promise.all(loads);

  const mosaic = document.createElement('canvas');
  mosaic.width = tilesX * tileW;
  mosaic.height = tilesY * tileH;
  const mctx = mosaic.getContext('2d')!;
  for (const { img, x, y } of loaded) {
    mctx.drawImage(img, x * tileW, y * tileH);
  }

  const canvas = document.createElement('canvas');
  canvas.width = OUT_WIDTH;
  canvas.height = OUT_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(mosaic, 0, 0, contentW, contentH, 0, 0, OUT_WIDTH, OUT_HEIGHT);

  return { canvas, centerHeading: tiles.centerHeading ?? 0 };
}

/**
 * Fetch (or reuse from cache) the low-res equirect image for a panorama.
 * Concurrent requests for the same pano are de-duplicated; any failure
 * resolves to `null` so the caller keeps its current environment.
 */
export function fetchPanoEquirect(panoId: string): Promise<PanoEquirect | null> {
  const cached = cache.get(panoId);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(panoId);
  if (pending) return pending;

  const task = buildEquirect(panoId)
    .then((result) => {
      if (result) {
        cache.set(panoId, result);
        if (cache.size > CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
      }
      return result;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(panoId));

  inFlight.set(panoId, task);
  return task;
}
