/**
 * CoverageMap.tsx
 *
 * Top-down map panel showing where Street View is available, with a toggle
 * between a Google map and a Cesium view. Lazy-loaded (ConnectedChrome
 * `React.lazy`s it) and the Cesium SDK only loads from the CDN when the user
 * flips to Cesium mode, so neither ships in the main chunk.
 *
 * Every billable source here is opt-in and off by default — see the
 * "Coverage map" section of BILLING_SAFETY_CHECKLIST.md:
 *   Google mode   one Dynamic Maps load on first open; the Street View
 *                 coverage layer (tile traffic) only while toggled on.
 *   Cesium mode   linked-pano graph only while "Linked panos" is on
 *                 (metered `coverage-graph` lookups, cached per pano).
 *   Both          POI coverage colouring only while "POI coverage" is on
 *                 (metered `coverage-poi`, free when a graph node is ≤ 50 m).
 *   Map click     one metered `coverage-map-click` snap lookup.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadCesiumSDK } from '../hooks/useGlobeMode';
import {
  createMeteredPanoFetcher,
  walkPanoGraph,
  PANO_GRAPH_DEFAULTS,
  type PanoGraph,
} from '../services/maps/panoCoverageGraph';
import {
  classifyPoiCoverage,
  createMeteredPoiCoverageLookup,
  POI_COVERAGE_COLORS,
  type PoiCoverage,
} from '../search/poiCoverage';
import type { NearbyPoi } from '../search/poiModel';
import { createGoogleCoverageMap, type GoogleCoverageMap } from './coverageMap/googleCoverageMap';
import { createCesiumCoverageScene, type CesiumCoverageScene } from './coverageMap/cesiumCoverageScene';

export type CoverageMapMode = 'google' | 'cesium';

/** Snap radius for a click on empty map: generous enough to land on a nearby road. */
export const COVERAGE_MAP_CLICK_SNAP_RADIUS_M = 60;

interface CoverageMapProps {
  panorama: google.maps.StreetViewPanorama | null;
  pois: readonly NearbyPoi[];
  onTeleportPano: (panoId: string) => void;
  onClose: () => void;
}

interface PanoPose {
  lat: number;
  lng: number;
  panoId: string | null;
}

function readPose(panorama: google.maps.StreetViewPanorama | null): PanoPose | null {
  const pos = panorama?.getPosition();
  if (!pos) return null;
  return { lat: pos.lat(), lng: pos.lng(), panoId: panorama?.getPano() || null };
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const CoverageMap: React.FC<CoverageMapProps> = ({ panorama, pois, onTeleportPano, onClose }) => {
  const googleDivRef = useRef<HTMLDivElement>(null);
  const cesiumDivRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<GoogleCoverageMap | null>(null);
  const cesiumSceneRef = useRef<CesiumCoverageScene | null>(null);
  const svRef = useRef<google.maps.StreetViewService | null>(null);
  const walkGenRef = useRef(0);
  const messageTimerRef = useRef<number | null>(null);

  const [mode, setMode] = useState<CoverageMapMode>('google');
  const [pose, setPose] = useState<PanoPose | null>(() => readPose(panorama));
  const [showCoverageLayer, setShowCoverageLayer] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [checkPois, setCheckPois] = useState(false);
  const [graph, setGraph] = useState<PanoGraph | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [poiCoverage, setPoiCoverage] = useState<ReadonlyMap<string, PoiCoverage>>(new Map());
  const [googleReady, setGoogleReady] = useState(false);
  const [cesiumState, setCesiumState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const hasMapsSdk = typeof window !== 'undefined' && !!window.google?.maps;

  const getSv = useCallback(() => {
    if (!svRef.current && window.google?.maps?.StreetViewService) {
      svRef.current = new google.maps.StreetViewService();
    }
    return svRef.current;
  }, []);

  const flash = useCallback((text: string) => {
    setMessage(text);
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage(null), 2200);
  }, []);

  const onTeleportRef = useRef(onTeleportPano);
  onTeleportRef.current = onTeleportPano;

  const pickPano = useCallback((panoId: string) => onTeleportRef.current(panoId), []);

  const pickLatLng = useCallback(async (lat: number, lng: number) => {
    const sv = getSv();
    if (!sv) return;
    const hit = await createMeteredPoiCoverageLookup(sv, 'coverage-map-click')(lat, lng, COVERAGE_MAP_CLICK_SNAP_RADIUS_M);
    if (hit?.status === 'covered' && hit.panoId) onTeleportRef.current(hit.panoId);
    else flash(hit ? 'No Street View here' : 'Lookup unavailable');
  }, [flash, getSv]);

  // Follow the panorama.
  useEffect(() => {
    if (!panorama) return;
    setPose(readPose(panorama));
    const listener = panorama.addListener('position_changed', () => setPose(readPose(panorama)));
    return () => listener.remove();
  }, [panorama]);

  // Initial coords for lazily-built maps; later moves go through setCurrent/centerOn.
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const hasPose = !!pose;
  /** Bumped per Cesium start and on unmount; a stale async init destroys what it built. */
  const cesiumGenRef = useRef(0);
  const cesiumStartedRef = useRef(false);

  // Google map: built on first use in Google mode, kept until the panel closes.
  useEffect(() => {
    const start = poseRef.current;
    if (mode !== 'google' || googleMapRef.current || !googleDivRef.current || !start || !hasMapsSdk) return;
    try {
      googleMapRef.current = createGoogleCoverageMap(googleDivRef.current, start.lat, start.lng, {
        onPickLatLng: (lat, lng) => void pickLatLng(lat, lng),
        onPickPano: pickPano,
      });
      setGoogleReady(true);
    } catch (err) {
      console.warn('[CoverageMap] Google map failed:', err);
    }
  }, [mode, hasPose, hasMapsSdk, pickLatLng, pickPano]);

  // Cesium scene: CDN SDK + viewer on first use in Cesium mode, once per panel.
  useEffect(() => {
    const start = poseRef.current;
    if (mode !== 'cesium' || cesiumStartedRef.current || !start) return;
    cesiumStartedRef.current = true;
    const gen = ++cesiumGenRef.current;
    setCesiumState('loading');
    (async () => {
      try {
        await loadCesiumSDK();
        if (cesiumGenRef.current !== gen || !cesiumDivRef.current) return;
        const scene = await createCesiumCoverageScene(cesiumDivRef.current, start.lat, start.lng, {
          onPickLatLng: (lat, lng) => void pickLatLng(lat, lng),
          onPickPano: pickPano,
        });
        if (cesiumGenRef.current !== gen) {
          scene.destroy();
          return;
        }
        cesiumSceneRef.current = scene;
        setCesiumState('ready');
      } catch (err) {
        console.warn('[CoverageMap] Cesium view failed:', err);
        if (cesiumGenRef.current === gen) setCesiumState('failed');
      }
    })();
  }, [mode, hasPose, pickLatLng, pickPano]);

  useEffect(() => () => {
    cesiumGenRef.current += 1;
    cesiumStartedRef.current = false;
    walkGenRef.current += 1;
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    googleMapRef.current?.destroy();
    googleMapRef.current = null;
    cesiumSceneRef.current?.destroy();
    cesiumSceneRef.current = null;
    // StrictMode re-mount rebuilds both maps; let the dependent effects re-apply.
    setGoogleReady(false);
    setCesiumState('idle');
  }, []);

  useEffect(() => {
    if (!pose) return;
    googleMapRef.current?.setCurrent(pose.lat, pose.lng);
    googleMapRef.current?.centerOn(pose.lat, pose.lng);
    cesiumSceneRef.current?.setCurrent(pose.lat, pose.lng);
    cesiumSceneRef.current?.centerOn(pose.lat, pose.lng);
  }, [pose, googleReady, cesiumState]);

  useEffect(() => {
    googleMapRef.current?.setCoverageLayerVisible(showCoverageLayer);
  }, [showCoverageLayer, googleReady]);

  // Linked-pano graph: walk on enable, and again only once the current pano
  // leaves the drawn graph (cruising inside it costs nothing).
  const panoId = pose?.panoId ?? null;
  const panoInGraph = !!graph && !!panoId && graph.nodes.some((n) => n.panoId === panoId);
  useEffect(() => {
    if (!showGraph || !panoId || panoInGraph) return;
    const sv = getSv();
    if (!sv) return;
    const gen = ++walkGenRef.current;
    setGraphBusy(true);
    walkPanoGraph(panoId, createMeteredPanoFetcher(sv))
      .then((g) => { if (walkGenRef.current === gen) setGraph(g); })
      .finally(() => { if (walkGenRef.current === gen) setGraphBusy(false); });
  }, [showGraph, panoId, panoInGraph, getSv]);

  useEffect(() => {
    cesiumSceneRef.current?.setGraph(showGraph ? graph : null, panoId);
  }, [graph, showGraph, panoId, cesiumState]);

  useEffect(() => {
    if (!checkPois || pois.length === 0) return;
    const sv = getSv();
    if (!sv) return;
    let cancelled = false;
    classifyPoiCoverage(pois, createMeteredPoiCoverageLookup(sv), graph?.nodes).then((result) => {
      if (!cancelled) setPoiCoverage(result);
    });
    return () => { cancelled = true; };
  }, [checkPois, pois, graph, getSv]);

  useEffect(() => {
    const coverage = checkPois ? poiCoverage : new Map<string, PoiCoverage>();
    googleMapRef.current?.setPois(pois, coverage);
    cesiumSceneRef.current?.setPois(pois, coverage);
  }, [pois, poiCoverage, checkPois, googleReady, cesiumState]);

  const layerStyle = (active: boolean): React.CSSProperties => ({
    position: 'absolute',
    inset: 0,
    visibility: active ? 'visible' : 'hidden',
  });

  return (
    <div
      role="dialog"
      aria-label="Street View coverage map"
      style={{
        position: 'absolute',
        left: 16,
        bottom: 16,
        width: 'min(380px, calc(100vw - 32px))',
        zIndex: 150,
        background: 'rgba(12,14,18,0.92)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
      onMouseDown={stop}
      onMouseUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={stop}
      onKeyDown={stop}
      onKeyUp={stop}
      onPointerDown={stop}
      onTouchStart={stop}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
        <strong style={{ flex: 1 }}>Coverage map</strong>
        <div role="group" aria-label="Map mode" style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.25)' }}>
          {(['google', 'cesium'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              style={{
                padding: '3px 10px',
                border: 'none',
                cursor: 'pointer',
                color: '#fff',
                background: mode === m ? 'rgba(0,204,255,0.45)' : 'transparent',
              }}
            >
              {m === 'google' ? 'Google' : 'Cesium'}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Close coverage map" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16 }}>
          ×
        </button>
      </div>

      <div style={{ position: 'relative', height: 260, background: '#1b1f24' }}>
        <div ref={googleDivRef} style={layerStyle(mode === 'google')} data-testid="coverage-map-google" />
        <div ref={cesiumDivRef} style={layerStyle(mode === 'cesium')} data-testid="coverage-map-cesium" />
        {mode === 'google' && !hasMapsSdk && <Notice text="Google Maps isn't loaded yet." />}
        {mode === 'cesium' && cesiumState === 'loading' && <Notice text="Loading 3D map…" />}
        {mode === 'cesium' && cesiumState === 'failed' && <Notice text="3D map unavailable (WebGL / CDN)." />}
        {message && <Notice text={message} />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px' }}>
        {mode === 'google' && (
          <Toggle
            checked={showCoverageLayer}
            onChange={setShowCoverageLayer}
            label="Street View coverage"
            hint="streams Google coverage tiles while on"
          />
        )}
        {mode === 'cesium' && (
          <Toggle
            checked={showGraph}
            onChange={setShowGraph}
            label="Linked panos"
            hint={graphBusy
              ? 'walking links…'
              : graph && showGraph
                ? `${graph.nodes.length} panos${graph.truncated ? ' (capped)' : ''} · click one to jump`
                : `up to ${PANO_GRAPH_DEFAULTS.maxNodes} lookups`}
          />
        )}
        {pois.length > 0 && (
          <Toggle
            checked={checkPois}
            onChange={setCheckPois}
            label="POI coverage"
            hint="pano within 50 m?"
          />
        )}
        {pois.length > 0 && checkPois && (
          <div style={{ display: 'flex', gap: 10, opacity: 0.8, fontSize: 12 }}>
            <Legend color={POI_COVERAGE_COLORS.covered} text="Street View" />
            <Legend color={POI_COVERAGE_COLORS.none} text="None" />
            <Legend color={POI_COVERAGE_COLORS.unknown} text="Unchecked" />
          </div>
        )}
        <div style={{ opacity: 0.6, fontSize: 11 }}>Click the map to jump to the nearest panorama.</div>
      </div>
    </div>
  );
};

function Notice({ text }: { text: string }) {
  return (
    <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, padding: '4px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.7)', textAlign: 'center', pointerEvents: 'none' }}>
      {text}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      <span style={{ opacity: 0.6, fontSize: 11 }}>— {hint}</span>
    </label>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {text}
    </span>
  );
}

export default CoverageMap;
