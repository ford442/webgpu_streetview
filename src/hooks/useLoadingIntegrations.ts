/**
 * loadingIntegrations.ts - Integration helpers for loading states
 * 
 * This file provides hooks and utilities to integrate loading states
 * with existing components like StreetView, VehicleSelector, etc.
 */

import { useCallback, useEffect, useRef } from 'react';
import { loadingStateManager } from '../store/loadingState';
import { useCameraTransition } from './useTransition';

/**
 * Hook to track Street View panorama loading
 * Integrates with the loadingStateManager for 'streetview' type
 */
export function useStreetViewLoading() {
    const startLoading = useCallback((message: string = 'Loading Street View...') => {
        loadingStateManager.startLoading('streetview', message, 0);
    }, []);

    const updateProgress = useCallback((progress: number, message?: string) => {
        loadingStateManager.updateProgress('streetview', progress, message);
    }, []);

    const stopLoading = useCallback(() => {
        loadingStateManager.stopLoading('streetview');
    }, []);

    const setError = useCallback((error: string, retryCallback?: () => void) => {
        loadingStateManager.setError('streetview', error, true, retryCallback);
    }, []);

    return {
        startLoading,
        updateProgress,
        stopLoading,
        setError,
    };
}

/**
 * Hook to track vehicle switching with smooth transitions
 */
export function useVehicleLoading() {
    const startLoading = useCallback((message: string = 'Switching vehicle...') => {
        loadingStateManager.startLoading('vehicle', message);
    }, []);

    const stopLoading = useCallback(() => {
        loadingStateManager.stopLoading('vehicle');
    }, []);

    const setError = useCallback((error: string, retryCallback?: () => void) => {
        loadingStateManager.setError('vehicle', error, true, retryCallback);
    }, []);

    return {
        startLoading,
        stopLoading,
        setError,
    };
}

/**
 * Hook for camera recentering with loading indicator
 */
export function useCameraLoading() {
    const { isRecentering, recenter } = useCameraTransition(500);

    const startRecentering = useCallback(() => {
        loadingStateManager.startLoading('camera', 'Recentering camera...', 0);
    }, []);

    const stopRecentering = useCallback(() => {
        loadingStateManager.stopLoading('camera');
    }, []);

    // Automatically track recentering state
    useEffect(() => {
        if (isRecentering) {
            startRecentering();
        } else {
            stopRecentering();
        }
    }, [isRecentering, startRecentering, stopRecentering]);

    return {
        isRecentering,
        recenter,
        startRecentering,
        stopRecentering,
    };
}

/**
 * Hook to track 3D model loading progress
 */
export function useModelLoading() {
    const progressRef = useRef(0);

    const startLoading = useCallback((message: string = 'Loading 3D models...') => {
        progressRef.current = 0;
        loadingStateManager.startLoading('model', message, 0);
    }, []);

    const updateProgress = useCallback((progress: number, message?: string) => {
        progressRef.current = progress;
        loadingStateManager.updateProgress('model', progress, message);
    }, []);

    const incrementProgress = useCallback((amount: number, message?: string) => {
        progressRef.current = Math.min(100, progressRef.current + amount);
        loadingStateManager.updateProgress('model', progressRef.current, message);
    }, []);

    const stopLoading = useCallback(() => {
        loadingStateManager.stopLoading('model');
        progressRef.current = 0;
    }, []);

    const setError = useCallback((error: string, retryCallback?: () => void) => {
        loadingStateManager.setError('model', error, true, retryCallback);
    }, []);

    return {
        startLoading,
        updateProgress,
        incrementProgress,
        stopLoading,
        setError,
        getProgress: () => progressRef.current,
    };
}

/**
 * Hook to track route planning loading
 */
export function useRouteLoading() {
    const startLoading = useCallback((message: string = 'Calculating route...') => {
        loadingStateManager.startLoading('route', message);
    }, []);

    const updateProgress = useCallback((progress: number, message?: string) => {
        loadingStateManager.updateProgress('route', progress, message);
    }, []);

    const stopLoading = useCallback(() => {
        loadingStateManager.stopLoading('route');
    }, []);

    const setError = useCallback((error: string, retryCallback?: () => void) => {
        loadingStateManager.setError('route', error, true, retryCallback);
    }, []);

    return {
        startLoading,
        updateProgress,
        stopLoading,
        setError,
    };
}

/**
 * Hook to track search operations
 */
export function useSearchLoading() {
    const startLoading = useCallback((message: string = 'Searching...') => {
        loadingStateManager.startLoading('search', message);
    }, []);

    const stopLoading = useCallback(() => {
        loadingStateManager.stopLoading('search');
    }, []);

    const setError = useCallback((error: string, retryCallback?: () => void) => {
        loadingStateManager.setError('search', error, true, retryCallback);
    }, []);

    return {
        startLoading,
        stopLoading,
        setError,
    };
}

/**
 * Combined hook for all loading states
 */
export function useAllLoadingStates() {
    const streetView = useStreetViewLoading();
    const vehicle = useVehicleLoading();
    const camera = useCameraLoading();
    const model = useModelLoading();
    const route = useRouteLoading();
    const search = useSearchLoading();

    const resetAll = useCallback(() => {
        loadingStateManager.resetAll();
    }, []);

    return {
        streetView,
        vehicle,
        camera,
        model,
        route,
        search,
        resetAll,
    };
}

export default useAllLoadingStates;
