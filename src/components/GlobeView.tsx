/**
 * GlobeView.tsx
 *
 * CesiumJS globe overlay: mount + viewer lifecycle + composition.
 * Camera / input / journey live in `src/components/globe/`.
 * Cesium is CDN-loaded — no static import.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GlobeTransition } from '../hooks/useGlobeMode';
import { resolveMiniMapLayerOptions } from '../utils/cesiumImagery';
import ScoutCard from './ScoutCard';
import { type GlobeBookmark, type GlobePOI } from './globe/globeTypes';
import { addLocationBeacon, syncGlobeBookmarkEntities, syncGlobePoiEntities } from './globe/globePoiLayer';
import { syncGlobeAutopilotVisuals } from './globe/globeAutopilot';
import {
  flyGlobeEnterOrbit,
  flyGlobeExitDescend,
  requestOrbitalDrop,
  setGlobeStreetView,
} from './globe/globeCamera';
import { attachGlobeInput } from './globe/globeInput';
import {
  appendGlobeWaypoint,
  canStartJourney,
  GlobeWaypointPanel,
  journeyPayload,
} from './globe/globeJourney';
import {
  GlobeContextFailed,
  GlobeLoadingOverlay,
  GlobeModeHud,
  GlobeReturnHatch,
  GlobeToast,
} from './globe/GlobeChrome';
import type {
  CesiumEntity,
  CesiumImageryLayer,
  CesiumTerrainProvider,
  CesiumViewer,
} from '../types/cesium';

export type { GlobePOI, GlobeBookmark } from './globe/globeTypes';

interface GlobeViewProps {
  transition: GlobeTransition;
  currentLat: number;
  currentLng: number;
  currentHeading: number;
  pois: GlobePOI[];
  bookmarks: GlobeBookmark[];
  mapsApiKey: string;
  onTeleportRequest: (lat: number, lng: number) => void;
  onEnterComplete: () => void;
  onExitComplete: () => void;
  onRequestExit: () => void;
  onStartJourney?: (waypoints: { lat: number; lng: number }[]) => void;
}

const GlobeView: React.FC<GlobeViewProps> = ({
  transition,
  currentLat,
  currentLng,
  currentHeading,
  pois,
  bookmarks,
  mapsApiKey,
  onTeleportRequest,
  onEnterComplete,
  onExitComplete,
  onRequestExit,
  onStartJourney,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const detachInputRef = useRef<(() => void) | null>(null);
  const locationEntityRef = useRef<CesiumEntity | null>(null);
  const poiEntitiesRef = useRef<CesiumEntity[]>([]);
  const bookmarkEntitiesRef = useRef<CesiumEntity[]>([]);
  const waypointEntitiesRef = useRef<CesiumEntity[]>([]);
  const waypointPolylineRef = useRef<CesiumEntity | null>(null);
  const svServiceRef = useRef<google.maps.StreetViewService | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const onEnterRef = useRef(onEnterComplete);
  const onExitRef = useRef(onExitComplete);
  const onTeleportRef = useRef(onTeleportRequest);
  onEnterRef.current = onEnterComplete;
  onExitRef.current = onExitComplete;
  onTeleportRef.current = onTeleportRequest;

  const [scoutTarget, setScoutTarget] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const [waypoints, setWaypoints] = useState<{ lat: number; lng: number }[]>([]);
  const [contextFailed, setContextFailed] = useState(false);
  const [viewerReady, setViewerReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200) as unknown as number;
  }, []);

  const entryCoords = useRef({ lat: currentLat, lng: currentLng, heading: currentHeading });

  const handleScoutEngage = useCallback((lat: number, lng: number) => {
    setScoutTarget(null);
    requestOrbitalDrop({
      viewer: viewerRef.current,
      heading: currentHeading,
      lat,
      lng,
      svService: svServiceRef.current,
      onTeleport: (tLat, tLng) => onTeleportRef.current(tLat, tLng),
      onNoStreetView: () => showToast('No Street View here'),
    });
  }, [currentHeading, showToast]);

  const handleScoutEngageRef = useRef(handleScoutEngage);
  handleScoutEngageRef.current = handleScoutEngage;

  useEffect(() => {
    if (transition !== 'entering') return;
    if (viewerRef.current) return;
    if (!containerRef.current) return;
    if (typeof Cesium === 'undefined') {
      console.error('[GlobeView] Cesium not available on window');
      setContextFailed(true);
      return;
    }

    entryCoords.current = { lat: currentLat, lng: currentLng, heading: currentHeading };

    let cancelled = false;

    (async () => {
      let terrainProvider: CesiumTerrainProvider;
      let baseLayer: CesiumImageryLayer | false;
      try {
        ({ terrainProvider, baseLayer } = await resolveMiniMapLayerOptions(Cesium));
      } catch (err) {
        console.warn('[GlobeView] Layer options resolve failed; using ellipsoid fallback:', err);
        terrainProvider = new Cesium.EllipsoidTerrainProvider();
        baseLayer = false;
      }

      if (cancelled || viewerRef.current || !containerRef.current) return;

      let viewer: CesiumViewer;
      try {
        viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          navigationHelpButton: false,
          navigationInstructionsInitiallyVisible: false,
          skyAtmosphere: new Cesium.SkyAtmosphere(),
          terrainProvider,
          baseLayer,
        });
      } catch (err) {
        console.error('[GlobeView] Failed to create Cesium Viewer (WebGL context?):', err);
        setContextFailed(true);
        onEnterRef.current();
        return;
      }

      viewerRef.current = viewer;
      setViewerReady(true);

      if (!svServiceRef.current && window.google?.maps) {
        svServiceRef.current = new google.maps.StreetViewService();
      }

      const pose = { lat: currentLat, lng: currentLng, heading: currentHeading };
      setGlobeStreetView(viewer, pose);
      flyGlobeEnterOrbit(viewer, pose, () => onEnterRef.current());

      locationEntityRef.current = addLocationBeacon(viewer, currentLat, currentLng);

      const attached = attachGlobeInput(viewer, {
        onScoutPreview: (wp) => setScoutTarget({ lat: wp.lat, lng: wp.lng }),
        onOrbitalDrop: (wp) => handleScoutEngageRef.current(wp.lat, wp.lng),
        onAddWaypoint: (wp) => setWaypoints((prev) => appendGlobeWaypoint(prev, wp)),
        onBookmarkDrop: (wp) => handleScoutEngageRef.current(wp.lat, wp.lng),
      });
      detachInputRef.current = attached.detach;
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transition]);

  useEffect(() => {
    return () => {
      cleanupViewer();
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === 'undefined') return;
    poiEntitiesRef.current = syncGlobePoiEntities(viewer, pois, poiEntitiesRef.current);
  }, [pois, viewerReady]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === 'undefined') return;
    bookmarkEntitiesRef.current = syncGlobeBookmarkEntities(
      viewer,
      bookmarks,
      bookmarkEntitiesRef.current,
    );
  }, [bookmarks, viewerReady]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === 'undefined') return;
    const visuals = syncGlobeAutopilotVisuals(viewer, waypoints, {
      waypointEntities: waypointEntitiesRef.current,
      polylineEntity: waypointPolylineRef.current,
    });
    waypointEntitiesRef.current = visuals.waypointEntities;
    waypointPolylineRef.current = visuals.polylineEntity;
  }, [waypoints, viewerReady]);

  useEffect(() => {
    if (!locationEntityRef.current || typeof Cesium === 'undefined') return;
    locationEntityRef.current.position =
      Cesium.Cartesian3.fromDegrees(currentLng, currentLat, 80);
  }, [currentLat, currentLng]);

  useEffect(() => {
    if (transition !== 'exiting') return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) {
      onExitRef.current();
      return;
    }
    flyGlobeExitDescend(viewer, entryCoords.current, () => {
      cleanupViewer();
      onExitRef.current();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transition]);

  function cleanupViewer() {
    detachInputRef.current?.();
    detachInputRef.current = null;
    poiEntitiesRef.current = [];
    bookmarkEntitiesRef.current = [];
    waypointEntitiesRef.current = [];
    waypointPolylineRef.current = null;
    locationEntityRef.current = null;
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    const v = viewerRef.current;
    if (v && !v.isDestroyed()) v.destroy();
    viewerRef.current = null;
    setViewerReady(false);
    setContextFailed(false);
    setScoutTarget(null);
    setWaypoints([]);
    setToast(null);
  }

  const handleClearWaypoints = useCallback(() => setWaypoints([]), []);

  const handleStartJourney = useCallback(() => {
    if (!canStartJourney(waypoints)) return;
    onStartJourney?.(journeyPayload(waypoints));
  }, [waypoints, onStartJourney]);

  const visible = transition !== 'inactive' && transition !== 'loading';

  if (contextFailed) {
    return (
      <GlobeContextFailed
        onReturn={() => {
          setContextFailed(false);
          onExitRef.current();
        }}
      />
    );
  }

  return (
    <>
      {visible && <GlobeReturnHatch onRequestExit={onRequestExit} />}

      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 200,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'all' : 'none',
          transition: 'opacity 0.6s ease-in-out',
        }}
        aria-hidden={!visible}
      />

      {scoutTarget && visible && (
        <ScoutCard
          lat={scoutTarget.lat}
          lng={scoutTarget.lng}
          label={scoutTarget.label}
          mapsApiKey={mapsApiKey}
          onEngage={(lat, lng) => handleScoutEngage(lat, lng)}
          onClose={() => setScoutTarget(null)}
        />
      )}

      {(transition === 'active' || transition === 'entering') && <GlobeModeHud />}

      {transition === 'active' && waypoints.length > 0 && (
        <GlobeWaypointPanel
          waypoints={waypoints}
          onStartJourney={handleStartJourney}
          onClear={handleClearWaypoints}
        />
      )}

      {toast && visible && <GlobeToast message={toast} />}

      {transition === 'loading' && <GlobeLoadingOverlay onRequestExit={onRequestExit} />}
    </>
  );
};

export default GlobeView;
