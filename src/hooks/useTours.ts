import { useState, useEffect, useCallback, useRef } from 'react';

export interface TourWaypoint {
    id: string;
    panoId: string;
    position: { lat: number; lng: number };
    pov: { heading: number; pitch: number; zoom: number };
    dwellTimeMs: number;
    annotation?: string;
    snapshotId?: string;
}

export type TourTransitionType = 'hold-pause' | 'fade';

export interface Tour {
    id: string;
    name: string;
    description?: string;
    waypoints: TourWaypoint[];
    transitionType: TourTransitionType;
    autoPlaySpeed: number;
    createdAt: string;
    updatedAt: string;
}

export interface CurrentPOV {
    panoId: string;
    position: { lat: number; lng: number };
    pov: { heading: number; pitch: number; zoom: number };
}

const STORAGE_KEY = 'webgpu_streetview_tours';
const DEFAULT_DWELL_MS = 4000;
const MIN_WAYPOINT_INTERVAL_MS = 3000;

function makeId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function isValidTour(value: unknown): value is Tour {
    if (!value || typeof value !== 'object') return false;
    const t = value as Record<string, unknown>;
    return (
        typeof t.id === 'string' &&
        typeof t.name === 'string' &&
        Array.isArray(t.waypoints) &&
        t.waypoints.every((w) => {
            if (!w || typeof w !== 'object') return false;
            const wp = w as Record<string, unknown>;
            return (
                typeof wp.panoId === 'string' &&
                typeof wp.position === 'object' && wp.position !== null &&
                typeof (wp.position as any).lat === 'number' &&
                typeof (wp.position as any).lng === 'number' &&
                typeof wp.pov === 'object' && wp.pov !== null &&
                typeof wp.dwellTimeMs === 'number'
            );
        }) &&
        (t.transitionType === 'hold-pause' || t.transitionType === 'fade') &&
        typeof t.autoPlaySpeed === 'number'
    );
}

export function useTours() {
    const [tours, setTours] = useState<Tour[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Recording state
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [draftWaypoints, setDraftWaypoints] = useState<TourWaypoint[]>([]);
    const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const getCurrentPOVRef = useRef<(() => CurrentPOV | null) | null>(null);

    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setTours(parsed.filter(isValidTour));
                }
            }
        } catch (error) {
            console.error('Failed to load tours:', error);
        }
        setIsLoaded(true);
    }, []);

    useEffect(() => {
        if (isLoaded) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(tours));
            } catch (error) {
                console.error('Failed to save tours:', error);
            }
        }
    }, [tours, isLoaded]);

    const addWaypointFromCurrent = useCallback((dwellTimeMs: number = DEFAULT_DWELL_MS, annotation?: string) => {
        const current = getCurrentPOVRef.current?.();
        if (!current) return;
        setDraftWaypoints(prev => {
            const last = prev[prev.length - 1];
            if (last && last.panoId === current.panoId) return prev;
            const wp: TourWaypoint = {
                id: makeId(),
                panoId: current.panoId,
                position: current.position,
                pov: current.pov,
                dwellTimeMs,
                ...(annotation ? { annotation } : {}),
            };
            return [...prev, wp];
        });
    }, []);

    const startRecording = useCallback((name: string, getCurrentPOV: () => CurrentPOV | null, intervalMs: number = 0) => {
        setDraftName(name);
        setDraftWaypoints([]);
        getCurrentPOVRef.current = getCurrentPOV;
        setIsRecording(true);
        setIsPaused(false);

        if (recordingIntervalRef.current) {
            clearInterval(recordingIntervalRef.current);
            recordingIntervalRef.current = null;
        }
        if (intervalMs >= MIN_WAYPOINT_INTERVAL_MS) {
            recordingIntervalRef.current = setInterval(() => {
                addWaypointFromCurrent(DEFAULT_DWELL_MS);
            }, intervalMs);
        }
        // Capture the starting position immediately.
        addWaypointFromCurrent(DEFAULT_DWELL_MS);
    }, [addWaypointFromCurrent]);

    const pauseRecording = useCallback(() => {
        setIsPaused(true);
        if (recordingIntervalRef.current) {
            clearInterval(recordingIntervalRef.current);
            recordingIntervalRef.current = null;
        }
    }, []);

    const resumeRecording = useCallback(() => {
        setIsPaused(false);
    }, []);

    const cancelRecording = useCallback(() => {
        if (recordingIntervalRef.current) {
            clearInterval(recordingIntervalRef.current);
            recordingIntervalRef.current = null;
        }
        getCurrentPOVRef.current = null;
        setIsRecording(false);
        setIsPaused(false);
        setDraftWaypoints([]);
        setDraftName('');
    }, []);

    const stopRecording = useCallback((finalName?: string): string | null => {
        if (recordingIntervalRef.current) {
            clearInterval(recordingIntervalRef.current);
            recordingIntervalRef.current = null;
        }
        getCurrentPOVRef.current = null;
        setIsRecording(false);
        setIsPaused(false);

        if (draftWaypoints.length === 0) {
            setDraftWaypoints([]);
            setDraftName('');
            return null;
        }

        const now = new Date().toISOString();
        const newTour: Tour = {
            id: makeId(),
            name: (finalName ?? draftName).trim() || `Tour ${new Date().toLocaleDateString()}`,
            waypoints: draftWaypoints,
            transitionType: 'hold-pause',
            autoPlaySpeed: 1,
            createdAt: now,
            updatedAt: now,
        };
        setTours(prev => [newTour, ...prev]);
        setDraftWaypoints([]);
        setDraftName('');
        return newTour.id;
    }, [draftName, draftWaypoints]);

    const deleteTour = useCallback((id: string) => {
        setTours(prev => prev.filter(t => t.id !== id));
    }, []);

    const renameTour = useCallback((id: string, name: string) => {
        setTours(prev => prev.map(t => t.id === id ? { ...t, name, updatedAt: new Date().toISOString() } : t));
    }, []);

    const updateTourSettings = useCallback((id: string, updates: Partial<Pick<Tour, 'transitionType' | 'autoPlaySpeed' | 'description'>>) => {
        setTours(prev => prev.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t));
    }, []);

    const removeWaypoint = useCallback((tourId: string, waypointId: string) => {
        setTours(prev => prev.map(t => t.id === tourId
            ? { ...t, waypoints: t.waypoints.filter(w => w.id !== waypointId), updatedAt: new Date().toISOString() }
            : t));
    }, []);

    const updateWaypoint = useCallback((tourId: string, waypointId: string, updates: Partial<Omit<TourWaypoint, 'id'>>) => {
        setTours(prev => prev.map(t => t.id === tourId
            ? {
                ...t,
                waypoints: t.waypoints.map(w => w.id === waypointId ? { ...w, ...updates } : w),
                updatedAt: new Date().toISOString(),
            }
            : t));
    }, []);

    const moveWaypoint = useCallback((tourId: string, waypointId: string, direction: 'up' | 'down') => {
        setTours(prev => prev.map(t => {
            if (t.id !== tourId) return t;
            const idx = t.waypoints.findIndex(w => w.id === waypointId);
            if (idx === -1) return t;
            const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
            if (swapIdx < 0 || swapIdx >= t.waypoints.length) return t;
            const waypoints = [...t.waypoints];
            [waypoints[idx], waypoints[swapIdx]] = [waypoints[swapIdx]!, waypoints[idx]!];
            return { ...t, waypoints, updatedAt: new Date().toISOString() };
        }));
    }, []);

    const exportTourJson = useCallback((tour: Tour): string => {
        return JSON.stringify(tour, null, 2);
    }, []);

    const downloadTourJson = useCallback((tour: Tour) => {
        const blob = new Blob([JSON.stringify(tour, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${tour.name.replace(/[^a-z0-9-_ ]/gi, '_') || 'tour'}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, []);

    const downloadTourKml = useCallback((tour: Tour) => {
        const blob = new Blob([tourToKml(tour)], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${tour.name.replace(/[^a-z0-9-_ ]/gi, '_') || 'tour'}.kml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, []);

    const importTourFromJson = useCallback((jsonText: string): string => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(jsonText);
        } catch {
            throw new Error('Invalid JSON file');
        }
        if (!isValidTour(parsed)) {
            throw new Error('File does not contain a valid tour');
        }
        const now = new Date().toISOString();
        const imported: Tour = {
            ...parsed,
            id: makeId(),
            waypoints: parsed.waypoints.map(w => ({ ...w, id: w.id || makeId() })),
            createdAt: parsed.createdAt || now,
            updatedAt: now,
        };
        setTours(prev => [imported, ...prev]);
        return imported.id;
    }, []);

    return {
        tours,
        isLoaded,
        deleteTour,
        renameTour,
        updateTourSettings,
        removeWaypoint,
        updateWaypoint,
        moveWaypoint,
        exportTourJson,
        downloadTourJson,
        downloadTourKml,
        importTourFromJson,

        // Recording
        isRecording,
        isPaused,
        draftName,
        draftWaypoints,
        startRecording,
        pauseRecording,
        resumeRecording,
        cancelRecording,
        stopRecording,
        addWaypointFromCurrent,
    };
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function tourToKml(tour: Tour): string {
    const placemarks = tour.waypoints.map((wp, i) => `
    <Placemark>
      <name>${escapeXml(`${i + 1}. ${tour.name}`)}</name>
      ${wp.annotation ? `<description>${escapeXml(wp.annotation)}</description>` : ''}
      <Point>
        <coordinates>${wp.position.lng},${wp.position.lat},0</coordinates>
      </Point>
    </Placemark>`).join('');

    const lineCoords = tour.waypoints.map(wp => `${wp.position.lng},${wp.position.lat},0`).join(' ');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(tour.name)}</name>
    ${tour.description ? `<description>${escapeXml(tour.description)}</description>` : ''}
    <Placemark>
      <name>${escapeXml(tour.name)} route</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${lineCoords}</coordinates>
      </LineString>
    </Placemark>${placemarks}
  </Document>
</kml>`;
}
