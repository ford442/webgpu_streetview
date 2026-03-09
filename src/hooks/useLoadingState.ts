/**
 * useLoadingState.ts - React hook for loading state management
 * 
 * Provides easy integration with loadingStateManager for React components
 */

import { useState, useEffect, useCallback } from 'react';
import { LoadingType, loadingStateManager } from '../store/loadingState';

interface UseLoadingStateReturn {
  isLoading: boolean;
  message: string;
  progress?: number;
  error?: string;
  retryable?: boolean;
  startLoading: (message: string, progress?: number) => void;
  updateProgress: (progress: number, message?: string) => void;
  updateMessage: (message: string) => void;
  stopLoading: () => void;
  setError: (error: string, retryable?: boolean, retryCallback?: () => void) => void;
  clearError: () => void;
  retry: () => void;
}

/**
 * Hook for managing a specific loading state type
 */
export function useLoadingState(type: LoadingType): UseLoadingStateReturn {
  const [state, setState] = useState({
    isLoading: false,
    message: '',
    progress: undefined as number | undefined,
    error: undefined as string | undefined,
    retryable: false,
  });

  useEffect(() => {
    // Subscribe to loading state changes
    const unsubscribe = loadingStateManager.subscribe((states) => {
      const loadingState = states[type];
      setState({
        isLoading: loadingState.isLoading,
        message: loadingState.message,
        progress: loadingState.progress,
        error: loadingState.error,
        retryable: loadingState.retryable,
      });
    });

    return unsubscribe;
  }, [type]);

  const startLoading = useCallback((message: string, progress?: number) => {
    loadingStateManager.startLoading(type, message, progress);
  }, [type]);

  const updateProgress = useCallback((progress: number, message?: string) => {
    loadingStateManager.updateProgress(type, progress, message);
  }, [type]);

  const updateMessage = useCallback((message: string) => {
    loadingStateManager.updateMessage(type, message);
  }, [type]);

  const stopLoading = useCallback(() => {
    loadingStateManager.stopLoading(type);
  }, [type]);

  const setError = useCallback((error: string, retryable?: boolean, retryCallback?: () => void) => {
    loadingStateManager.setError(type, error, retryable, retryCallback);
  }, [type]);

  const clearError = useCallback(() => {
    loadingStateManager.clearError(type);
  }, [type]);

  const retry = useCallback(() => {
    loadingStateManager.retry(type);
  }, [type]);

  return {
    ...state,
    startLoading,
    updateProgress,
    updateMessage,
    stopLoading,
    setError,
    clearError,
    retry,
  };
}

/**
 * Hook for global loading state (any type loading)
 */
export function useGlobalLoadingState(): { isAnyLoading: boolean } {
  const [isAnyLoading, setIsAnyLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = loadingStateManager.subscribe(() => {
      setIsAnyLoading(loadingStateManager.isAnyLoading());
    });

    return unsubscribe;
  }, []);

  return { isAnyLoading };
}

export default useLoadingState;
