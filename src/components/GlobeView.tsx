/**
 * GlobeView.tsx
 *
 * CesiumJS-based 3D globe overlay. Lazy-loads Cesium via CDN on first use.
 * Activated by useGlobeMode hook.
 *
 * Features:
 * - Entry animation: camera starts at ground level then flies to orbit
 * - Exit animation: camera descends then triggers panorama teleport
 * - Double-click → "Orbital Drop": camera swoops to surface, teleports Street View
 * - Single-click → opens ScoutCard with Street View Static preview
 * - Bookmark entities: cyan beacons for saved bookmarks
 * - POI layer: orange beacons for location history
 * - Shift-click → drops waypoints with polyline for autopilot route
 * - Start Journey → autopilot along waypoints
 * - WebGL context failure → fallback UI
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GlobeTransition } from '../hooks/useGlobeMode';
import ScoutCard from './ScoutCard';

// Cesium is loaded from CDN at runtime, not bundled.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Cesium: any;

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
    /** Called with waypoints when user starts autopilot journey */
    onStartJourney?: (waypoints: { lat: number; lng: number }[]) => void;
}

// ----- Canvas helpers ---------------------------------------------------------

function makeBeaconCanvas(): string {
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

function makePoiCanvas(): string {
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

function makeBookmarkCanvas(): string {
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

function makeWaypointCanvas(): string {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,50,50,0.9)';
    ctx.beginPath(); ctx.arc(16, 16, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(16, 16, 4, 0, Math.PI * 2); ctx.fill();
    return c.toDataURL();
}

// Entity rendering limits — keeps Cesium performant with many entities.
// Billboard rendering becomes sluggish above ~80 entities at typical zoom levels.
const MAX_VISIBLE_BOOKMARKS = 50;
const MAX_VISIBLE_POIS = 30;

// ----- Component --------------------------------------------------------------

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
    onStartJourney,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<any>(null);
    const handlerRef = useRef<any>(null);
    const locationEntityRef = useRef<any>(null);
    const poiEntitiesRef = useRef<any[]>([]);
    const bookmarkEntitiesRef = useRef<any[]>([]);
    const waypointEntitiesRef = useRef<any[]>([]);
    const waypointPolylineRef = useRef<any>(null);

    // Stable refs for callbacks
    const onEnterRef = useRef(onEnterComplete);
    const onExitRef = useRef(onExitComplete);
    const onTeleportRef = useRef(onTeleportRequest);
    onEnterRef.current = onEnterComplete;
    onExitRef.current = onExitComplete;
    onTeleportRef.current = onTeleportRequest;

    // ScoutCard state
    const [scoutTarget, setScoutTarget] = useState<{ lat: number; lng: number; label?: string } | null>(null);

    // Waypoints state (for Phase 5 autopilot)
    const [waypoints, setWaypoints] = useState<{ lat: number; lng: number }[]>([]);

    // WebGL context failure state
    const [contextFailed, setContextFailed] = useState(false);

    // Snapshot coords when entering
    const entryCoords = useRef({ lat: currentLat, lng: currentLng, heading: currentHeading });

    // ---- Handle ScoutCard engage (Orbital Drop) ----
    const handleScoutEngage = useCallback((lat: number, lng: number) => {
        setScoutTarget(null);
        const viewer = viewerRef.current;
        if (!viewer || viewer.isDestroyed()) {
            onTeleportRef.current(lat, lng);
            return;
        }
        // Orbital Drop animation
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lng, lat, 250),
            orientation: {
                heading: Cesium.Math.toRadians(currentHeading),
                pitch: Cesium.Math.toRadians(-35),
                roll: 0,
            },
            duration: 2.5,
            complete: () => {
                onTeleportRef.current(lat, lng);
            },
        });
    }, [currentHeading]);

    // ---- initialise Cesium once when entering --------------------------------
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

        // Suppress Ion token console noise — we use OSM which needs no Ion token
        Cesium.Ion.defaultAccessToken = '';

        let viewer: any;
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
                skyAtmosphere: true,
                terrainProvider: new Cesium.EllipsoidTerrainProvider(),
                imageryProvider: new Cesium.UrlTemplateImageryProvider({
                    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    credit: '© OpenStreetMap contributors',
                    maximumLevel: 19,
                }),
            });
        } catch (err) {
            console.error('[GlobeView] Failed to create Cesium Viewer (WebGL context?):', err);
            setContextFailed(true);
            onEnterRef.current();
            return;
        }

        viewerRef.current = viewer;

        // Start camera at street level
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(currentLng, currentLat, 120),
            orientation: {
                heading: Cesium.Math.toRadians(currentHeading),
                pitch: Cesium.Math.toRadians(-15),
                roll: 0,
            },
        });

        // Orbital rise
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(currentLng, currentLat, 1_800_000),
            orientation: {
                heading: Cesium.Math.toRadians(currentHeading),
                pitch: Cesium.Math.toRadians(-90),
                roll: 0,
            },
            duration: 3.5,
            complete: () => onEnterRef.current(),
        });

        // "You are here" beacon
        const beaconImage = makeBeaconCanvas();
        locationEntityRef.current = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(currentLng, currentLat, 80),
            billboard: {
                image: beaconImage,
                scale: 1.0,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
            },
            label: {
                text: '📍 You are here',
                font: 'bold 13px sans-serif',
                fillColor: Cesium.Color.fromCssColorString('#00CCFF'),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -55),
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.75)'),
                backgroundPadding: new Cesium.Cartesian2(8, 4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });

        // POI beacons (location history)
        const poiImage = makePoiCanvas();
        poiEntitiesRef.current = pois.slice(0, MAX_VISIBLE_POIS).map(poi =>
            viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, 60),
                billboard: {
                    image: poiImage,
                    scale: 0.85,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: {
                    text: poi.label,
                    font: '12px sans-serif',
                    fillColor: Cesium.Color.fromCssColorString('#FFB400'),
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 1,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -42),
                    showBackground: true,
                    backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.65)'),
                    backgroundPadding: new Cesium.Cartesian2(6, 3),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
        );

        // Bookmark beacons (green glowing markers)
        const bookmarkImage = makeBookmarkCanvas();
        bookmarkEntitiesRef.current = bookmarks.slice(0, MAX_VISIBLE_BOOKMARKS).map(bm =>
            viewer.entities.add({
                name: bm.name,
                position: Cesium.Cartesian3.fromDegrees(bm.lng, bm.lat, 70),
                billboard: {
                    image: bookmarkImage,
                    scale: 0.95,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: {
                    text: `📌 ${bm.name}`,
                    font: 'bold 12px sans-serif',
                    fillColor: Cesium.Color.fromCssColorString('#00FF80'),
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -40),
                    showBackground: true,
                    backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'),
                    backgroundPadding: new Cesium.Cartesian2(6, 3),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                properties: {
                    bookmarkId: bm.id,
                    bookmarkLat: bm.lat,
                    bookmarkLng: bm.lng,
                    bookmarkName: bm.name,
                },
            })
        );

        // --- Event handlers ---

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        // Double-click → Orbital Drop (immediate teleport)
        handler.setInputAction((event: { position: any }) => {
            const cartesian = viewer.camera.pickEllipsoid(
                event.position,
                viewer.scene.globe.ellipsoid,
            );
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const lng = Cesium.Math.toDegrees(carto.longitude);

            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lng, lat, 250),
                orientation: {
                    heading: Cesium.Math.toRadians(currentHeading),
                    pitch: Cesium.Math.toRadians(-35),
                    roll: 0,
                },
                duration: 2.5,
                complete: () => {
                    onTeleportRef.current(lat, lng);
                },
            });
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        // Single-click (unmodified) → ScoutCard preview.
        // Shift+click is handled by a separate handler registered below with
        // Cesium.KeyboardEventModifier.SHIFT, so it won't reach this handler.
        handler.setInputAction((event: { position: any }) => {
            const picked = viewer.scene.pick(event.position);
            if (Cesium.defined(picked) && picked.id && picked.id.properties) {
                // Clicked on a bookmark or POI entity
                try {
                    const props = picked.id.properties;
                    const bLat = props.bookmarkLat?.getValue();
                    const bLng = props.bookmarkLng?.getValue();
                    const bName = props.bookmarkName?.getValue();
                    if (bLat !== undefined && bLng !== undefined) {
                        setScoutTarget({ lat: bLat, lng: bLng, label: bName || undefined });
                        return;
                    }
                } catch { /* fall through to globe pick */ }
            }

            // Clicked on globe surface → preview that location
            const cartesian = viewer.camera.pickEllipsoid(
                event.position,
                viewer.scene.globe.ellipsoid,
            );
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const lng = Cesium.Math.toDegrees(carto.longitude);
            setScoutTarget({ lat, lng });
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Shift+click → drop waypoint
        handler.setInputAction((event: { position: any }) => {
            const cartesian = viewer.camera.pickEllipsoid(
                event.position,
                viewer.scene.globe.ellipsoid,
            );
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const lng = Cesium.Math.toDegrees(carto.longitude);

            setWaypoints(prev => [...prev, { lat, lng }]);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK, Cesium.KeyboardEventModifier.SHIFT);

        handlerRef.current = handler;

        return () => { cleanupViewer(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transition]);

    // ---- Update waypoint visuals on globe ----
    useEffect(() => {
        const viewer = viewerRef.current;
        if (!viewer || viewer.isDestroyed() || typeof Cesium === 'undefined') return;

        // Remove old waypoint entities
        waypointEntitiesRef.current.forEach(e => {
            try { viewer.entities.remove(e); } catch { /* noop */ }
        });
        if (waypointPolylineRef.current) {
            try { viewer.entities.remove(waypointPolylineRef.current); } catch { /* noop */ }
        }

        if (waypoints.length === 0) {
            waypointEntitiesRef.current = [];
            waypointPolylineRef.current = null;
            return;
        }

        const wpImage = makeWaypointCanvas();
        waypointEntitiesRef.current = waypoints.map((wp, i) =>
            viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, 50),
                billboard: {
                    image: wpImage,
                    scale: 1.0,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: {
                    text: `WP ${i + 1}`,
                    font: 'bold 11px sans-serif',
                    fillColor: Cesium.Color.fromCssColorString('#FF3232'),
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -28),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
        );

        // Draw polyline between waypoints
        if (waypoints.length >= 2) {
            const positions = waypoints.map(wp =>
                Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, 50)
            );
            waypointPolylineRef.current = viewer.entities.add({
                polyline: {
                    positions,
                    width: 3,
                    material: Cesium.Color.fromCssColorString('rgba(255,50,50,0.8)'),
                    clampToGround: false,
                },
            });
        }
    }, [waypoints]);

    // ---- update beacon when street view position changes ---------------------
    useEffect(() => {
        if (!locationEntityRef.current || typeof Cesium === 'undefined') return;
        locationEntityRef.current.position =
            Cesium.Cartesian3.fromDegrees(currentLng, currentLat, 80);
    }, [currentLat, currentLng]);

    // ---- handle exit ---------------------------------------------------------
    useEffect(() => {
        if (transition !== 'exiting') return;
        const viewer = viewerRef.current;
        if (!viewer || viewer.isDestroyed()) {
            onExitRef.current();
            return;
        }
        const { lat, lng, heading } = entryCoords.current;
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lng, lat, 120),
            orientation: {
                heading: Cesium.Math.toRadians(heading),
                pitch: Cesium.Math.toRadians(-30),
                roll: 0,
            },
            duration: 2.2,
            complete: () => {
                cleanupViewer();
                onExitRef.current();
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transition]);

    function cleanupViewer() {
        handlerRef.current?.destroy();
        handlerRef.current = null;
        poiEntitiesRef.current = [];
        bookmarkEntitiesRef.current = [];
        waypointEntitiesRef.current = [];
        waypointPolylineRef.current = null;
        locationEntityRef.current = null;
        const v = viewerRef.current;
        if (v && !v.isDestroyed()) v.destroy();
        viewerRef.current = null;
        setContextFailed(false);
        setScoutTarget(null);
        setWaypoints([]);
    }

    const handleClearWaypoints = useCallback(() => {
        setWaypoints([]);
    }, []);

    const handleStartJourney = useCallback(() => {
        if (waypoints.length === 0) return;
        onStartJourney?.(waypoints);
    }, [waypoints, onStartJourney]);

    const visible = transition !== 'inactive' && transition !== 'loading';

    // ---- WebGL context failure fallback ----
    if (contextFailed) {
        return (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 200,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.85)',
                    color: '#fff',
                    fontFamily: 'system-ui, sans-serif',
                    gap: 16,
                }}
            >
                <div style={{ fontSize: 48 }}>🌍</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Globe View Unavailable</div>
                <div style={{ fontSize: 14, color: '#aaa', maxWidth: 400, textAlign: 'center' }}>
                    WebGL context could not be created. This may happen if too many GPU contexts
                    are active, or your browser doesn't support WebGL. Try refreshing the page.
                </div>
                <button
                    onClick={() => {
                        setContextFailed(false);
                        onExitRef.current();
                    }}
                    style={{
                        marginTop: 12,
                        padding: '10px 24px',
                        backgroundColor: 'rgba(0,204,255,0.2)',
                        border: '1px solid rgba(0,204,255,0.5)',
                        borderRadius: 8,
                        color: '#00CCFF',
                        fontSize: 14,
                        cursor: 'pointer',
                    }}
                >
                    Return to Street View
                </button>
            </div>
        );
    }

    return (
        <>
            {/* Full-screen Cesium container */}
            <div
                ref={containerRef}
                style={{
                    position: 'fixed',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 200,
                    opacity: visible ? 1 : 0,
                    pointerEvents: visible ? 'all' : 'none',
                    transition: 'opacity 0.6s ease-in-out',
                }}
                aria-hidden={!visible}
            />

            {/* ScoutCard overlay */}
            {scoutTarget && visible && (
                <ScoutCard
                    lat={scoutTarget.lat}
                    lng={scoutTarget.lng}
                    label={scoutTarget.label}
                    mapsApiKey={mapsApiKey}
                    onEngage={handleScoutEngage}
                    onClose={() => setScoutTarget(null)}
                />
            )}

            {/* HUD overlay shown when active */}
            {(transition === 'active' || transition === 'entering') && (
                <div
                    style={{
                        position: 'fixed',
                        bottom: 30,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 201,
                        backgroundColor: 'rgba(0,0,0,0.72)',
                        color: '#fff',
                        padding: '10px 20px',
                        borderRadius: '20px',
                        fontSize: '13px',
                        fontFamily: 'system-ui, sans-serif',
                        border: '1px solid rgba(0,204,255,0.4)',
                        boxShadow: '0 0 20px rgba(0,204,255,0.2)',
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                    }}
                >
                    <span>
                        🌍 Globe Mode — <strong>click</strong> to preview | <strong>double-click</strong> to drop in |
                        <strong> Shift+click</strong> to add waypoint
                    </span>
                    <span style={{ color: '#666' }}>|</span>
                    <span>
                        Press <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>Shift+G</kbd> to return
                    </span>
                </div>
            )}

            {/* Waypoint controls */}
            {transition === 'active' && waypoints.length > 0 && (
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
                            onClick={handleStartJourney}
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
                            onClick={handleClearWaypoints}
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
            )}

            {/* Loading indicator */}
            {transition === 'loading' && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    fontSize: '18px',
                    fontFamily: 'system-ui, sans-serif',
                }}>
                    🌍 Loading Globe…
                </div>
            )}
        </>
    );
};

export default GlobeView;
