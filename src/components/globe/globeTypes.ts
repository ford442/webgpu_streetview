export function makeBeaconCanvas(): string {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,204,255,0.9)');
  g.addColorStop(0.4, 'rgba(0,204,255,0.4)');
  g.addColorStop(1, 'rgba(0,204,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  ctx.beginPath(); ctx.arc(32, 32, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#00CCFF'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  return c.toDataURL();
}

export function makePoiCanvas(): string {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 40;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(20, 20, 2, 20, 20, 17);
  g.addColorStop(0, 'rgba(255,180,0,0.95)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 40, 40);
  ctx.beginPath(); ctx.arc(20, 20, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFB400'; ctx.fill();
  return c.toDataURL();
}

export function makeBookmarkCanvas(): string {
  const c = document.createElement('canvas');
  c.width = 48; c.height = 48;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(24, 24, 3, 24, 24, 22);
  g.addColorStop(0, 'rgba(0,255,128,0.95)');
  g.addColorStop(0.5, 'rgba(0,255,128,0.3)');
  g.addColorStop(1, 'rgba(0,255,128,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 48, 48);
  ctx.beginPath(); ctx.arc(24, 24, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#00FF80'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  return c.toDataURL();
}

export function makeWaypointCanvas(): string {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,50,50,0.9)';
  ctx.beginPath(); ctx.arc(16, 16, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(16, 16, 4, 0, Math.PI * 2); ctx.fill();
  return c.toDataURL();
}

/** Entity rendering limits — keeps Cesium performant with many entities. */
export const MAX_VISIBLE_BOOKMARKS = 50;
export const MAX_VISIBLE_POIS = 30;

export interface GlobePOI {
  lat: number;
  lng: number;
  label: string;
}

export interface GlobeBookmark {
  id: string;
  name: string;
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
}

export interface GlobeWaypoint {
  lat: number;
  lng: number;
}
