/**
 * Turn-by-turn data for the cabin centre display, and the pure formatting
 * behind it (shared with the screen-reader announcements). The cabin reads
 * only this shape; `views/car/useCabinRouteGuidance.ts` maps `tripStore` onto it.
 */

export type GuidanceManeuver =
  | 'depart' | 'continue' | 'turn-left' | 'turn-right' | 'slight-left' | 'slight-right'
  | 'sharp-left' | 'sharp-right' | 'uturn' | 'merge' | 'fork-left' | 'fork-right'
  | 'roundabout' | 'arrive';

export interface RouteGuidance {
  maneuver: GuidanceManeuver;
  /** Road the next maneuver turns onto ('' when unnamed). */
  street: string;
  distanceToNextM: number;
  /** Seconds to arrival at the measured cruise pace, or null before it is known. */
  etaS: number | null;
  /** Along-track road distance driven so far on this route. */
  travelledM: number;
  remainingM: number;
  totalM: number;
  avgSpeedKmh: number | null;
  arrived: boolean;
  exit?: number;
}

/** "120 m", "1.4 km", "12 km" — rounded the way a nav screen rounds. */
export function formatGuidanceDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) {
    const step = meters < 100 ? 5 : meters < 300 ? 10 : 50;
    return `${Math.round(meters / step) * step} m`;
  }
  return meters < 10000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 1000)} km`;
}

/** "45 s", "12 min", "1 h 05 min"; "—" when unknown. */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

const MANEUVER_TEXT: Record<GuidanceManeuver, string> = {
  depart: 'Head off',
  continue: 'Continue',
  'turn-left': 'Turn left',
  'turn-right': 'Turn right',
  'slight-left': 'Bear left',
  'slight-right': 'Bear right',
  'sharp-left': 'Sharp left',
  'sharp-right': 'Sharp right',
  uturn: 'Make a U-turn',
  merge: 'Merge',
  'fork-left': 'Keep left',
  'fork-right': 'Keep right',
  roundabout: 'At the roundabout',
  arrive: 'Arrive',
};

/** One short instruction: "Turn right onto Side Road", "Arrive at destination". */
export function maneuverInstruction(maneuver: GuidanceManeuver, street: string, exit?: number): string {
  if (maneuver === 'arrive') return 'Arrive at destination';
  if (maneuver === 'roundabout' && exit) {
    const ord = exit === 1 ? '1st' : exit === 2 ? '2nd' : exit === 3 ? '3rd' : `${exit}th`;
    return `At the roundabout, take the ${ord} exit${street ? ` onto ${street}` : ''}`;
  }
  return street ? `${MANEUVER_TEXT[maneuver]} onto ${street}` : MANEUVER_TEXT[maneuver];
}

/**
 * Arrow geometry for a maneuver glyph in a unit box (x right, y down, origin at
 * the stem's base): the polyline the arrow shaft follows. The head is drawn at
 * the last point, pointing along the last segment.
 */
export function maneuverGlyphPath(maneuver: GuidanceManeuver): [number, number][] {
  switch (maneuver) {
    case 'turn-left': return [[0.55, 1], [0.55, 0.45], [0.15, 0.45]];
    case 'turn-right': return [[0.45, 1], [0.45, 0.45], [0.85, 0.45]];
    case 'slight-left': case 'fork-left': return [[0.55, 1], [0.55, 0.6], [0.25, 0.2]];
    case 'slight-right': case 'fork-right': case 'merge': return [[0.45, 1], [0.45, 0.6], [0.75, 0.2]];
    case 'sharp-left': return [[0.6, 1], [0.6, 0.3], [0.2, 0.75]];
    case 'sharp-right': return [[0.4, 1], [0.4, 0.3], [0.8, 0.75]];
    case 'uturn': return [[0.65, 1], [0.65, 0.3], [0.35, 0.3], [0.35, 0.7]];
    default: return [[0.5, 1], [0.5, 0.1]];
  }
}
