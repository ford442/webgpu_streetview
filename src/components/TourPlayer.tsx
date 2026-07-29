import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Tour } from '../hooks/useTours';
import type { RouteGraphNode } from '../offline';
import { findPathBetweenPanos } from '../offline';

interface TourPlayerProps {
    tour: Tour;
    teleportToPano: (panoId: string) => Promise<void>;
    setHeading: (heading: number) => void;
    setPitch: (pitch: number) => void;
    setZoom: (zoom: number) => void;
    isPanoramaReady: boolean;
    /** Loads this tour's prefetched pano link graph, if one was prepared (see useRoutePrefetch). */
    getRouteGraph?: (routeId: string) => Promise<RouteGraphNode[]>;
    /** Pre-warms the panorama cache for a lat/lng, used to smooth hops the offline graph knows about. */
    prewarmPanoCache?: (lat: number, lng: number) => Promise<unknown>;
}

const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
};

const SPEEDS = [0.5, 1, 1.5, 2];

const TourPlayer: React.FC<TourPlayerProps> = ({
    tour,
    teleportToPano,
    setHeading,
    setPitch,
    setZoom,
    isPanoramaReady,
    getRouteGraph,
    prewarmPanoCache,
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [speed, setSpeed] = useState(() => (SPEEDS.includes(tour.autoPlaySpeed) ? tour.autoPlaySpeed : 1));
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const speedRef = useRef(speed);
    speedRef.current = speed;
    const runTokenRef = useRef(0);
    const routeGraphNodesRef = useRef<RouteGraphNode[]>([]);

    // Reset playback position whenever a different tour is loaded.
    useEffect(() => {
        setCurrentIndex(0);
        setIsPlaying(false);
    }, [tour.id]);

    // Load this tour's prefetched link graph (if any) once per tour, so
    // playback can use known link edges to pre-warm upcoming hops.
    useEffect(() => {
        routeGraphNodesRef.current = [];
        if (!getRouteGraph) return;
        let cancelled = false;
        getRouteGraph(tour.id)
            .then((nodes) => {
                if (!cancelled) routeGraphNodesRef.current = nodes;
            })
            .catch((err) => console.warn('[TourPlayer] Failed to load offline route graph', err));
        return () => {
            cancelled = true;
        };
    }, [tour.id, getRouteGraph]);

    const visitWaypoint = useCallback(async (index: number) => {
        const wp = tour.waypoints[index];
        if (!wp) return;

        // If we know a prefetched link path from the previous waypoint to this
        // one, pre-warm those intermediate panos — smooths playback online,
        // never used to alter where we actually teleport.
        const prevWp = tour.waypoints[index - 1];
        if (prewarmPanoCache && prevWp && routeGraphNodesRef.current.length > 0) {
            const path = findPathBetweenPanos(routeGraphNodesRef.current, prevWp.panoId, wp.panoId);
            if (path) {
                for (const node of path) {
                    void prewarmPanoCache(node.lat, node.lng);
                }
            }
        }

        await teleportToPano(wp.panoId);
        setHeading(wp.pov.heading);
        setPitch(wp.pov.pitch);
        setZoom(wp.pov.zoom);
    }, [tour.waypoints, teleportToPano, setHeading, setPitch, setZoom, prewarmPanoCache]);

    // Playback loop: advances through waypoints from currentIndex while isPlaying.
    useEffect(() => {
        if (!isPlaying) return;
        const token = ++runTokenRef.current;

        const run = async () => {
            let idx = currentIndex;
            while (idx < tour.waypoints.length) {
                if (runTokenRef.current !== token) return;
                await visitWaypoint(idx);
                if (runTokenRef.current !== token) return;
                setCurrentIndex(idx);

                const wp = tour.waypoints[idx]!;
                const effectiveDwell = tour.transitionType === 'hold-pause'
                    ? wp.dwellTimeMs
                    : Math.min(wp.dwellTimeMs, 800);
                await new Promise(resolve => setTimeout(resolve, effectiveDwell / speedRef.current));
                if (runTokenRef.current !== token) return;
                idx++;
            }
            if (runTokenRef.current === token) setIsPlaying(false);
        };
        run();
        return () => {
            runTokenRef.current = token + 1;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying]);

    useEffect(() => {
        const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const toggleFullscreen = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            containerRef.current?.requestFullscreen?.().catch(() => {});
        }
    };

    const handleScrub = (index: number) => {
        setIsPlaying(false);
        runTokenRef.current++;
        setCurrentIndex(index);
        visitWaypoint(index);
    };

    const waypointCount = tour.waypoints.length;

    return (
        <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: isFullscreen ? '#111' : 'transparent', padding: isFullscreen ? '20px' : 0 }}>
            <div style={{ color: '#ccc', fontSize: '13px' }}>
                Waypoint {waypointCount === 0 ? 0 : currentIndex + 1} / {waypointCount}
                {tour.waypoints[currentIndex]?.annotation ? ` — ${tour.waypoints[currentIndex]!.annotation}` : ''}
            </div>

            <input
                type="range"
                min={0}
                max={Math.max(0, waypointCount - 1)}
                value={currentIndex}
                disabled={waypointCount === 0}
                onChange={(e) => handleScrub(Number(e.target.value))}
                aria-label="Tour scrub bar"
                style={{ width: '100%' }}
            />

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                    style={{ ...btnStyle, backgroundColor: '#4CAF50' }}
                    disabled={waypointCount === 0 || !isPanoramaReady}
                    onClick={() => {
                        if (currentIndex >= waypointCount - 1 && !isPlaying) setCurrentIndex(0);
                        setIsPlaying(p => !p);
                    }}
                    aria-label={isPlaying ? 'Pause tour' : 'Play tour'}
                >
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
                <button
                    style={{ ...btnStyle, backgroundColor: '#555' }}
                    onClick={() => { setIsPlaying(false); runTokenRef.current++; setCurrentIndex(0); }}
                    aria-label="Stop tour"
                >
                    ■ Stop
                </button>

                <label style={{ color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Speed:
                    <select
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        style={{ padding: '4px', backgroundColor: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                    >
                        {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
                    </select>
                </label>

                <button
                    style={{ ...btnStyle, backgroundColor: '#2196F3' }}
                    onClick={toggleFullscreen}
                    aria-label="Toggle fullscreen playback"
                >
                    {isFullscreen ? '⤢ Exit Fullscreen' : '⛶ Fullscreen'}
                </button>
            </div>
        </div>
    );
};

export default TourPlayer;
