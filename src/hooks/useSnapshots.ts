import { useState, useEffect, useCallback } from 'react';
import { loadMirroredJson, saveMirroredJson } from '../offline/offlinePersistence';
import { buildStudioShareUrl } from '../utils/studioLink';
import {
    ImageExportFormat,
    convertDataUrlFormat,
    blobToDataUrl,
    formatExtension,
} from '../utils/imageExport';
import { embedExifGps } from '../utils/exifGps';

export interface SnapshotMetadata {
    id: string;
    name: string;
    dataUrl: string;
    timestamp: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom: number;
    locationName?: string;
    panoId?: string;
    imageDate?: string;
    lookId?: string;
    vehicleType?: string;
    /** Quarter-res JPEG from downsample_2d for the gallery picker. */
    thumbnailDataUrl?: string;
}

export type SnapshotShareResult = 'share' | 'clipboard' | 'cancelled';

import { MAPS_ATTRIBUTION } from '../utils/attribution';

const MAX_SNAPSHOTS = 20; // Limit stored snapshots to avoid storage quota issues

async function prepareExport(
    snapshot: SnapshotMetadata,
    format: ImageExportFormat,
): Promise<{ dataUrl: string; extension: string; mimeType: string }> {
    if (format === 'jpeg') {
        const jpegBlob = await convertDataUrlFormat(snapshot.dataUrl, 'jpeg');
        const jpegDataUrl = await blobToDataUrl(jpegBlob);
        const withExif = embedExifGps(jpegDataUrl, {
            lat: snapshot.lat,
            lng: snapshot.lng,
            heading: snapshot.heading,
            pitch: snapshot.pitch,
            zoom: snapshot.zoom,
            panoId: snapshot.panoId,
            timestamp: snapshot.timestamp,
            imageDate: snapshot.imageDate,
            lookId: snapshot.lookId,
            vehicleType: snapshot.vehicleType,
        });
        return { dataUrl: withExif, extension: formatExtension(format), mimeType: 'image/jpeg' };
    }
    if (format === 'webp') {
        const blob = await convertDataUrlFormat(snapshot.dataUrl, 'webp');
        return { dataUrl: await blobToDataUrl(blob), extension: formatExtension(format), mimeType: 'image/webp' };
    }
    return { dataUrl: snapshot.dataUrl, extension: formatExtension('png'), mimeType: 'image/png' };
}

export function useSnapshots() {
    const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load snapshots from IndexedDB (mirrors localStorage) on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const stored = await loadMirroredJson<SnapshotMetadata[]>('snapshots');
                if (!cancelled && Array.isArray(stored)) {
                    setSnapshots(stored);
                }
            } catch (error) {
                console.error('Failed to load snapshots:', error);
            }
            if (!cancelled) setIsLoaded(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Save snapshots to localStorage whenever they change
    useEffect(() => {
        if (!isLoaded) return;

        let idleHandle: number | null = null;

        // Debounce the save operation by 1000ms
        const debounceTimer = setTimeout(() => {
            const saveOperation = async () => {
                try {
                    await saveMirroredJson('snapshots', snapshots);
                } catch (error) {
                    console.error('Failed to save snapshots:', error);
                    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                        setSnapshots(prev => {
                            const reduced = prev.slice(0, -5);
                            void saveMirroredJson('snapshots', reduced).catch(() => {
                                console.error('Still exceeded quota after reduction');
                            });
                            return reduced;
                        });
                    }
                }
            };

            // Use requestIdleCallback to avoid blocking the main thread during heavy serialization
            if ('requestIdleCallback' in window) {
                idleHandle = (window as any).requestIdleCallback(saveOperation, { timeout: 2000 });
            } else {
                saveOperation();
            }
        }, 1000);

        return () => {
            clearTimeout(debounceTimer);
            if (idleHandle !== null && 'cancelIdleCallback' in window) {
                (window as any).cancelIdleCallback(idleHandle);
            }
        };
    }, [snapshots, isLoaded]);

    const addSnapshot = useCallback((snapshot: Omit<SnapshotMetadata, 'id' | 'timestamp'>) => {
        const newSnapshot: SnapshotMetadata = {
            ...snapshot,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
        };
        
        setSnapshots(prev => {
            // Add to beginning and limit to MAX_SNAPSHOTS
            const newSnapshots = [newSnapshot, ...prev].slice(0, MAX_SNAPSHOTS);
            return newSnapshots;
        });
        
        return newSnapshot.id;
    }, []);

    const removeSnapshot = useCallback((id: string) => {
        setSnapshots(prev => prev.filter(s => s.id !== id));
    }, []);

    const updateSnapshotName = useCallback((id: string, name: string) => {
        setSnapshots(prev => prev.map(s => 
            s.id === id ? { ...s, name } : s
        ));
    }, []);

    const clearAllSnapshots = useCallback(() => {
        if (window.confirm('Are you sure you want to delete all saved snapshots?')) {
            setSnapshots([]);
        }
    }, []);

    const downloadSnapshot = useCallback(async (snapshot: SnapshotMetadata, format: ImageExportFormat = 'png') => {
        const { dataUrl, extension } = await prepareExport(snapshot, format);
        const link = document.createElement('a');
        link.download = `${snapshot.name || 'snapshot'}.${extension}`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, []);

    const getSnapshotDeepLink = useCallback((snapshot: SnapshotMetadata) => {
        return buildStudioShareUrl({
            lat: snapshot.lat,
            lng: snapshot.lng,
            heading: snapshot.heading,
            pitch: snapshot.pitch,
            zoom: snapshot.zoom,
            panoId: snapshot.panoId,
            lookId: snapshot.lookId,
            year: snapshot.imageDate,
            vehicleType: snapshot.vehicleType,
        });
    }, []);

    const shareSnapshot = useCallback(async (
        snapshot: SnapshotMetadata,
        format: ImageExportFormat = 'jpeg',
    ): Promise<SnapshotShareResult> => {
        const link = buildStudioShareUrl({
            lat: snapshot.lat,
            lng: snapshot.lng,
            heading: snapshot.heading,
            pitch: snapshot.pitch,
            zoom: snapshot.zoom,
            panoId: snapshot.panoId,
            lookId: snapshot.lookId,
            year: snapshot.imageDate,
            vehicleType: snapshot.vehicleType,
        });
        const shareText = `${snapshot.locationName || `${snapshot.lat.toFixed(4)}, ${snapshot.lng.toFixed(4)}`} — captured in WebGPU StreetView\n${MAPS_ATTRIBUTION}`;

        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                const { dataUrl, extension, mimeType } = await prepareExport(snapshot, format);
                const blob = await (await fetch(dataUrl)).blob();
                const file = new File([blob], `${snapshot.name || 'snapshot'}.${extension}`, { type: mimeType });
                const canShareFiles = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });

                await navigator.share(
                    canShareFiles
                        ? { title: snapshot.name || 'Street View Snapshot', text: shareText, url: link, files: [file] }
                        : { title: snapshot.name || 'Street View Snapshot', text: shareText, url: link },
                );
                return 'share';
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    return 'cancelled';
                }
                console.error('Share failed, falling back to clipboard:', error);
            }
        }

        await navigator.clipboard.writeText(link);
        return 'clipboard';
    }, []);

    return {
        snapshots,
        isLoaded,
        addSnapshot,
        removeSnapshot,
        updateSnapshotName,
        clearAllSnapshots,
        downloadSnapshot,
        getSnapshotDeepLink,
        shareSnapshot,
    };
}
