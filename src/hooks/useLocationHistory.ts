import { useState, useEffect, useCallback } from 'react';

export interface HistoryEntry {
    id: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    locationName: string;
    timestamp: string;
}

const STORAGE_KEY = 'webgpu_streetview_history';
const MAX_HISTORY_ITEMS = 50; // Keep last 50 locations

export function useLocationHistory() {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load history from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setHistory(parsed);
                }
            }
        } catch (error) {
            console.error('Failed to load location history:', error);
        }
        setIsLoaded(true);
    }, []);

    // Save history to localStorage whenever it changes
    useEffect(() => {
        if (isLoaded) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
            } catch (error) {
                console.error('Failed to save location history:', error);
            }
        }
    }, [history, isLoaded]);

    const addToHistory = useCallback((entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => {
        setHistory(prev => {
            // Check if this location is very close to the last one (within ~10 meters)
            const lastEntry = prev[0];
            if (lastEntry) {
                const distance = calculateDistance(
                    lastEntry.lat, lastEntry.lng,
                    entry.lat, entry.lng
                );
                // If within 10 meters and less than 1 minute apart, don't add
                if (distance < 0.01 && 
                    (new Date().getTime() - new Date(lastEntry.timestamp).getTime()) < 60000) {
                    return prev;
                }
            }

            const newEntry: HistoryEntry = {
                ...entry,
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date().toISOString(),
            };
            
            // Add to beginning and limit to MAX_HISTORY_ITEMS
            const newHistory = [newEntry, ...prev].slice(0, MAX_HISTORY_ITEMS);
            return newHistory;
        });
    }, []);

    const removeFromHistory = useCallback((id: string) => {
        setHistory(prev => prev.filter(h => h.id !== id));
    }, []);

    const clearHistory = useCallback(() => {
        if (window.confirm('Are you sure you want to clear all location history?')) {
            setHistory([]);
        }
    }, []);

    return {
        history,
        isLoaded,
        addToHistory,
        removeFromHistory,
        clearHistory,
    };
}

// Helper function to calculate distance between two points in km
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
