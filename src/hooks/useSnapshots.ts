import { useState, useEffect, useCallback } from 'react';

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
}

const STORAGE_KEY = 'webgpu_streetview_snapshots';
const MAX_SNAPSHOTS = 20; // Limit stored snapshots to avoid storage quota issues

export function useSnapshots() {
    const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load snapshots from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setSnapshots(parsed);
                }
            }
        } catch (error) {
            console.error('Failed to load snapshots:', error);
        }
        setIsLoaded(true);
    }, []);

    // Save snapshots to localStorage whenever they change
    useEffect(() => {
        if (isLoaded) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
            } catch (error) {
                console.error('Failed to save snapshots:', error);
                // If storage quota exceeded, remove oldest and try again
                if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                    setSnapshots(prev => {
                        const reduced = prev.slice(0, -5); // Remove 5 oldest
                        try {
                            localStorage.setItem(STORAGE_KEY, JSON.stringify(reduced));
                        } catch (e) {
                            console.error('Still exceeded quota after reduction');
                        }
                        return reduced;
                    });
                }
            }
        }
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

    const downloadSnapshot = useCallback((snapshot: SnapshotMetadata) => {
        const link = document.createElement('a');
        link.download = `${snapshot.name || 'snapshot'}.png`;
        link.href = snapshot.dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, []);

    return {
        snapshots,
        isLoaded,
        addSnapshot,
        removeSnapshot,
        updateSnapshotName,
        clearAllSnapshots,
        downloadSnapshot,
    };
}
