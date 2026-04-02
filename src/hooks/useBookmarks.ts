import { useState, useEffect, useCallback } from 'react';
import {
    fetchCloudLocations,
    saveLocationToCloud,
    deleteLocationFromCloud,
    updateLocationInCloud,
    CloudLocation,
    SaveLocationRequest,
} from '../services/storageApi';

export interface Bookmark {
    id: string;
    name: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    timestamp: string;
    cloudId?: string;
    isCloudSyncing?: boolean;
}

const STORAGE_KEY = 'webgpu_streetview_bookmarks';

export function useBookmarks() {
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);

    // Load bookmarks from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setBookmarks(parsed);
                }
            }
        } catch (error) {
            console.error('Failed to load bookmarks:', error);
        }
        setIsLoaded(true);
    }, []);

    // Save bookmarks to localStorage whenever they change
    useEffect(() => {
        if (isLoaded) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
            } catch (error) {
                console.error('Failed to save bookmarks:', error);
            }
        }
    }, [bookmarks, isLoaded]);

    const addBookmark = useCallback((bookmark: Omit<Bookmark, 'id' | 'timestamp'>) => {
        const newBookmark: Bookmark = {
            ...bookmark,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
        };
        setBookmarks(prev => [newBookmark, ...prev]);
        return newBookmark.id;
    }, []);

    const removeBookmark = useCallback((id: string) => {
        setBookmarks(prev => prev.filter(b => b.id !== id));
    }, []);

    const updateBookmark = useCallback((id: string, updates: Partial<Omit<Bookmark, 'id'>>) => {
        setBookmarks(prev => prev.map(b => 
            b.id === id ? { ...b, ...updates } : b
        ));
    }, []);

    const clearAllBookmarks = useCallback(() => {
        if (window.confirm('Are you sure you want to delete all bookmarks?')) {
            setBookmarks([]);
        }
    }, []);

    // Cloud sync: load all cloud locations and merge with local bookmarks
    const loadCloudBookmarks = useCallback(async () => {
        setIsSyncing(true);
        setSyncError(null);
        try {
            const cloudLocations = await fetchCloudLocations();
            const cloudBookmarks: Bookmark[] = cloudLocations.map(loc => ({
                id: `cloud-${loc.id}`,
                cloudId: loc.id,
                name: loc.name,
                lat: loc.lat,
                lng: loc.lng,
                heading: loc.heading,
                pitch: loc.pitch,
                timestamp: loc.date || new Date().toISOString(),
            }));

            setBookmarks(prev => {
                // Remove old cloud bookmarks to avoid duplicates
                const localOnly = prev.filter(b => !b.cloudId);
                // Merge: local first, then cloud bookmarks that aren't already present
                const localIds = new Set(localOnly.map(b => `${b.lat.toFixed(6)},${b.lng.toFixed(6)}`));
                const newCloud = cloudBookmarks.filter(
                    cb => !localIds.has(`${cb.lat.toFixed(6)},${cb.lng.toFixed(6)}`)
                );
                return [...localOnly, ...newCloud];
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load cloud bookmarks';
            setSyncError(message);
            console.error('Failed to load cloud bookmarks:', err);
        } finally {
            setIsSyncing(false);
        }
    }, []);

    // Cloud sync: save a single bookmark to the cloud
    const saveBookmarkToCloud = useCallback(async (bookmarkId: string) => {
        const bookmark = bookmarks.find(b => b.id === bookmarkId);
        if (!bookmark) return;

        setBookmarks(prev => prev.map(b => b.id === bookmarkId ? { ...b, isCloudSyncing: true } : b));
        setSyncError(null);

        try {
            const payload: SaveLocationRequest = {
                name: bookmark.name,
                lat: bookmark.lat,
                lng: bookmark.lng,
                heading: bookmark.heading,
                pitch: bookmark.pitch,
                zoom: 1.0,
                description: '',
                tags: ['streetview', 'bookmark'],
            };

            if (bookmark.cloudId) {
                // Already in cloud: update
                const updateResult = await updateLocationInCloud(bookmark.cloudId, payload);
                setBookmarks(prev => prev.map(b =>
                    b.id === bookmarkId
                        ? { ...b, cloudId: updateResult.location.id, isCloudSyncing: false }
                        : b
                ));
            } else {
                const result = await saveLocationToCloud(payload);
                setBookmarks(prev => prev.map(b =>
                    b.id === bookmarkId
                        ? { ...b, cloudId: result.location.id, isCloudSyncing: false }
                        : b
                ));
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save to cloud';
            setSyncError(message);
            setBookmarks(prev => prev.map(b => b.id === bookmarkId ? { ...b, isCloudSyncing: false } : b));
            console.error('Failed to save bookmark to cloud:', err);
        }
    }, [bookmarks]);

    // Cloud sync: remove a bookmark from the cloud (but keep local)
    const removeCloudBookmark = useCallback(async (bookmarkId: string) => {
        const bookmark = bookmarks.find(b => b.id === bookmarkId);
        if (!bookmark || !bookmark.cloudId) return;

        setBookmarks(prev => prev.map(b => b.id === bookmarkId ? { ...b, isCloudSyncing: true } : b));
        setSyncError(null);

        try {
            await deleteLocationFromCloud(bookmark.cloudId);
            setBookmarks(prev => prev.map(b =>
                b.id === bookmarkId ? { ...b, cloudId: undefined, isCloudSyncing: false } : b
            ));
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to remove from cloud';
            setSyncError(message);
            setBookmarks(prev => prev.map(b => b.id === bookmarkId ? { ...b, isCloudSyncing: false } : b));
            console.error('Failed to remove cloud bookmark:', err);
        }
    }, [bookmarks]);

    // Cloud sync: save all local bookmarks to cloud
    const syncAllToCloud = useCallback(async () => {
        setIsSyncing(true);
        setSyncError(null);
        try {
            const localBookmarks = bookmarks.filter(b => !b.cloudId);
            const results = await Promise.allSettled(
                localBookmarks.map(async (bookmark) => {
                    const payload: SaveLocationRequest = {
                        name: bookmark.name,
                        lat: bookmark.lat,
                        lng: bookmark.lng,
                        heading: bookmark.heading,
                        pitch: bookmark.pitch,
                        zoom: 1.0,
                        description: '',
                        tags: ['streetview', 'bookmark'],
                    };
                    const result = await saveLocationToCloud(payload);
                    return { id: bookmark.id, cloudId: result.location.id };
                })
            );

            const successfulResults = results
                .filter((r): r is PromiseFulfilledResult<{ id: string; cloudId: string }> => r.status === 'fulfilled')
                .map(r => r.value);

            const failedCount = results.filter(r => r.status === 'rejected').length;
            if (failedCount > 0) {
                setSyncError(`Failed to sync ${failedCount} bookmarks to cloud`);
            }

            setBookmarks(prev => {
                const resultsMap = new Map(successfulResults.map(r => [r.id, r.cloudId]));
                return prev.map(b => {
                    if (resultsMap.has(b.id)) {
                        return { ...b, cloudId: resultsMap.get(b.id) };
                    }
                    return b;
                });
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to sync to cloud';
            setSyncError(message);
            console.error('Failed to sync all bookmarks to cloud:', err);
        } finally {
            setIsSyncing(false);
        }
    }, [bookmarks]);

    return {
        bookmarks,
        isLoaded,
        isSyncing,
        syncError,
        addBookmark,
        removeBookmark,
        updateBookmark,
        clearAllBookmarks,
        loadCloudBookmarks,
        saveBookmarkToCloud,
        removeCloudBookmark,
        syncAllToCloud,
    };
}
