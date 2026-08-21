import React from 'react';
import type { GlobeWaypoint } from './globeTypes';

export function appendGlobeWaypoint(
  prev: GlobeWaypoint[],
  wp: GlobeWaypoint,
): GlobeWaypoint[] {
  return [...prev, wp];
}

export function canStartJourney(waypoints: GlobeWaypoint[]): boolean {
  return waypoints.length > 0;
}

export function journeyPayload(waypoints: GlobeWaypoint[]): GlobeWaypoint[] {
  return waypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng }));
}

interface GlobeWaypointPanelProps {
  waypoints: GlobeWaypoint[];
  onStartJourney: () => void;
  onClear: () => void;
}

/** Overlay: waypoint count + Start Journey / Clear. Must stopPropagation. */
export const GlobeWaypointPanel: React.FC<GlobeWaypointPanelProps> = ({
  waypoints,
  onStartJourney,
  onClear,
}) => (
  <div
    style={{
      position: 'fixed',
      top: 20,
      right: 20,
      zIndex: 202,
      backgroundColor: 'rgba(0,0,0,0.85)',
      color: '#fff',
      padding: '12px 16px',
      borderRadius: 12,
      fontFamily: 'system-ui, sans-serif',
      fontSize: 13,
      border: '1px solid rgba(255,50,50,0.4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      pointerEvents: 'all',
    }}
    onClick={(e) => e.stopPropagation()}
    onMouseDown={(e) => e.stopPropagation()}
    onKeyDown={(e) => e.stopPropagation()}
  >
    <div style={{ fontWeight: 600 }}>
      🗺️ Waypoints ({waypoints.length})
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        onClick={onStartJourney}
        style={{
          padding: '6px 14px',
          backgroundColor: 'rgba(0,204,255,0.2)',
          border: '1px solid rgba(0,204,255,0.5)',
          borderRadius: 6,
          color: '#00CCFF',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        🚗 Start Journey
      </button>
      <button
        onClick={onClear}
        style={{
          padding: '6px 14px',
          backgroundColor: 'rgba(255,50,50,0.15)',
          border: '1px solid rgba(255,50,50,0.4)',
          borderRadius: 6,
          color: '#FF6464',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        ✕ Clear
      </button>
    </div>
  </div>
);
