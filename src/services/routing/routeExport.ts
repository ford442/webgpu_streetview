/**
 * src/services/routing/routeExport.ts
 * Trip ⇄ other shapes: GPX export of the routed polyline, and a tour's
 * waypoints as trip stops (so a recorded tour can be driven by road).
 */

import type { TripStop } from '../../state/tripStore';
import type { LatLng } from './RouteProvider';
import type { ActiveRoute } from './routeGeometry';
import { OSRM_MAX_WAYPOINTS } from './osrmProvider';
import { labelStops } from './routeLink';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** GPX 1.1: the stops as waypoints and the road polyline as one track. */
export function routeToGpx(route: Pick<ActiveRoute, 'polyline'>, stops: readonly TripStop[], name = 'Road trip'): string {
  const coord = (p: LatLng): string => `lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"`;
  const wpts = stops.map((s) => `  <wpt ${coord(s)}><name>${escapeXml(s.label)}</name></wpt>`).join('\n');
  const trkpts = route.polyline.map((p) => `      <trkpt ${coord(p)}/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WebGPU StreetView" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
${wpts}
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * A tour's waypoints as trip stops. Tours can hold hundreds of waypoints; a
 * route request takes at most {@link OSRM_MAX_WAYPOINTS}, so long tours are
 * thinned evenly (first and last always kept).
 */
export function tourWaypointsToStops(
  waypoints: readonly { position: LatLng; annotation?: string }[],
): TripStop[] | null {
  if (waypoints.length < 2) return null;
  const n = Math.min(waypoints.length, OSRM_MAX_WAYPOINTS);
  const picked = Array.from({ length: n }, (_, i) => waypoints[Math.round((i * (waypoints.length - 1)) / (n - 1))]!);
  return labelStops(picked.map((w) => w.position), picked.map((w) => w.annotation));
}

/** Save text as a file (GPX/JSON downloads). */
export function downloadTextFile(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
