import { useState, useEffect, useCallback } from 'react';

export interface Bookmark {
    id: string;
    name: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    timestamp: string;
}

const STORAGE_KEY = 'webgpu_streetview_bookmarks';

export function useBookmarks() {
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

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

    return {
        bookmarks,
        isLoaded,
        addBookmark,
        removeBookmark,
        updateBookmark,
        clearAllBookmarks,
    };
}
