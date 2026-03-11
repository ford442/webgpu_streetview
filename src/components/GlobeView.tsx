/**
 * GlobeView.tsx
 *
 * CesiumJS-based 3D globe overlay. Lazy-loads Cesium via CDN on first use.
 * Activated by useGlobeMode hook.
 *
 * Entry animation: camera starts at ground level (current street view position)
 *   then hyperbolic flyTo to 1,800 km orbit — preserving heading context.
 * Exit animation: Cesium camera drops back to ground level, then callback
 *   triggers panorama teleport and globe disposal.
 *
 * Double-click on globe → "Orbital Drop": camera swoops to 200 m altitude
 *   then calls onTeleportRequest to warp the Street View panorama there.
 *
 * POI layer: history entries rendered as glowing cyan beacons.
 */

import React, { useEffect, useRef } from 'react';
import { GlobeTransition } from '../hooks/useGlobeMode';

// Cesium is loaded from CDN at runtime, not bundled.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Cesium: any;

export interface GlobePOI {
    lat: number;
    lng: number;
    label: string;
}

interface GlobeViewProps {
    transition: GlobeTransition;
    currentLat: number;
    currentLng: number;
    currentHeading: number;
    pois: GlobePOI[];
    onTeleportRequest: (lat: number, lng: number) => void;
    onEnterComplete: () => void;
    onExitComplete: () => void;
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

// ----- Component --------------------------------------------------------------

const GlobeView: React.FC<GlobeViewProps> = ({
    transition,
    currentLat,
    currentLng,
    currentHeading,
    pois,
    onTeleportRequest,
    onEnterComplete,
    onExitComplete,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<any>(null);
    const handlerRef = useRef<any>(null);
    const locationEntityRef = useRef<any>(null);
    const poiEntitiesRef = useRef<any[]>([]);
    // Stable refs for callbacks so effects don't stale-close over them
    const onEnterRef = useRef(onEnterComplete);
    const onExitRef = useRef(onExitComplete);
    const onTeleportRef = useRef(onTeleportRequest);
    onEnterRef.current = onEnterComplete;
    onExitRef.current = onExitComplete;
    onTeleportRef.current = onTeleportRequest;

    // Snapshot coords when entering so exit animation returns to same spot
    const entryCoords = useRef({ lat: currentLat, lng: currentLng, heading: currentHeading });

    // ---- initialise Cesium once when entering --------------------------------
    useEffect(() => {
        if (transition !== 'entering') return;
        if (viewerRef.current) return;
        if (!containerRef.current) return;
        if (typeof Cesium === 'undefined') {
            console.error('[GlobeView] Cesium not available on window');
            return;
        }

        entryCoords.current = { lat: currentLat, lng: currentLng, heading: currentHeading };

        // Suppress Ion token console noise — we use OSM which needs no Ion token
        Cesium.Ion.defaultAccessToken = '';

        const viewer = new Cesium.Viewer(containerRef.current, {
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
            // Flat terrain — no Cesium Ion token required
            terrainProvider: new Cesium.EllipsoidTerrainProvider(),
            imageryProvider: new Cesium.UrlTemplateImageryProvider({
                url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                credit: '© OpenStreetMap contributors',
                maximumLevel: 19,
            }),
        });

        viewerRef.current = viewer;

        // Start camera at street level (exact position + heading)
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(currentLng, currentLat, 120),
            orientation: {
                heading: Cesium.Math.toRadians(currentHeading),
                pitch: Cesium.Math.toRadians(-15),
                roll: 0,
            },
        });

        // Orbital rise — hyperbolic pull-up preserving heading context
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
        poiEntitiesRef.current = pois.slice(0, 30).map(poi =>
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

        // Double-click → Orbital Drop to clicked location
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((event: { position: any }) => {
            const cartesian = viewer.camera.pickEllipsoid(
                event.position,
                viewer.scene.globe.ellipsoid,
            );
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const lng = Cesium.Math.toDegrees(carto.longitude);

            // Orbital Drop: hyperbolic descent to 250 m
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

        handlerRef.current = handler;

        // Cleanup on unmount (handles hot-reload / route changes)
        return () => { cleanupViewer(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transition]); // only init once when entering

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
        locationEntityRef.current = null;
        const v = viewerRef.current;
        if (v && !v.isDestroyed()) v.destroy();
        viewerRef.current = null;
    }

    const visible = transition !== 'inactive' && transition !== 'loading';

    return (
        <>
            {/* Full-screen Cesium container */}
            <div
                ref={containerRef}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 200,
                    opacity: visible ? 1 : 0,
                    pointerEvents: visible ? 'all' : 'none',
                    transition: 'opacity 0.6s ease-in-out',
                }}
                aria-hidden={!visible}
            />

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
                    }}
                >
                    🌍 Globe Mode — <strong>double-click</strong> anywhere to drop in &nbsp;|&nbsp;
                    Press <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>Shift+G</kbd> to return
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
