/**
 * loadingState.ts - Centralized loading state management for webgpu_streetview
 * 
 * Manages loading states for:
 * - Street View image fetching
 * - Vehicle switching transitions
 * - Camera recentering
 * - Error handling with retry
 */

export type LoadingType = 
  | 'streetview'
  | 'vehicle'
  | 'camera'
  | 'model'
  | 'route'
  | 'search';

export interface LoadingState {
  isLoading: boolean;
  message: string;
  progress?: number;
  error?: string;
  retryable?: boolean;
}

export interface LoadingStates {
  streetview: LoadingState;
  vehicle: LoadingState;
  camera: LoadingState;
  model: LoadingState;
  route: LoadingState;
  search: LoadingState;
}

type LoadingListener = (states: LoadingStates) => void;
type ErrorListener = (type: LoadingType, error: string, retryable: boolean) => void;

const DEFAULT_STATE: LoadingState = {
  isLoading: false,
  message: '',
  progress: undefined,
  error: undefined,
  retryable: false,
};

const DEFAULT_STATES: LoadingStates = {
  streetview: { ...DEFAULT_STATE },
  vehicle: { ...DEFAULT_STATE },
  camera: { ...DEFAULT_STATE },
  model: { ...DEFAULT_STATE },
  route: { ...DEFAULT_STATE },
  search: { ...DEFAULT_STATE },
};

class LoadingStateManager {
  private states: LoadingStates = { ...DEFAULT_STATES };
  private listeners: Set<LoadingListener> = new Set();
  private errorListeners: Set<ErrorListener> = new Set();
  private retryCallbacks: Map<LoadingType, (() => void)[]> = new Map();

  /**
   * Get current loading states
   */
  getStates(): LoadingStates {
    return { ...this.states };
  }

  /**
   * Get specific loading state
   */
  getState(type: LoadingType): LoadingState {
    return { ...this.states[type] };
  }

  /**
   * Check if any loading is active
   */
  isAnyLoading(): boolean {
    return Object.values(this.states).some(state => state.isLoading);
  }

  /**
   * Check if specific loading type is active
   */
  isLoading(type: LoadingType): boolean {
    return this.states[type].isLoading;
  }

  /**
   * Start loading with optional message and progress
   */
  startLoading(type: LoadingType, message: string, progress?: number): void {
    this.states[type] = {
      isLoading: true,
      message,
      progress,
      error: undefined,
      retryable: false,
    };
    this.notifyListeners();
  }

  /**
   * Update loading progress
   */
  updateProgress(type: LoadingType, progress: number, message?: string): void {
    if (!this.states[type].isLoading) return;
    
    this.states[type] = {
      ...this.states[type],
      progress: Math.max(0, Math.min(100, progress)),
      ...(message && { message }),
    };
    this.notifyListeners();
  }

  /**
   * Update loading message
   */
  updateMessage(type: LoadingType, message: string): void {
    if (!this.states[type].isLoading) return;
    
    this.states[type] = {
      ...this.states[type],
      message,
    };
    this.notifyListeners();
  }

  /**
   * Stop loading and clear error
   */
  stopLoading(type: LoadingType): void {
    this.states[type] = { ...DEFAULT_STATE };
    this.notifyListeners();
  }

  /**
   * Set error state with optional retry capability
   */
  setError(type: LoadingType, error: string, retryable: boolean = false, retryCallback?: () => void): void {
    this.states[type] = {
      isLoading: false,
      message: 'Error occurred',
      error,
      retryable,
    };

    if (retryCallback) {
      const callbacks = this.retryCallbacks.get(type) || [];
      callbacks.push(retryCallback);
      this.retryCallbacks.set(type, callbacks);
    }

    this.notifyListeners();
    this.notifyErrorListeners(type, error, retryable);
  }

  /**
   * Clear error state
   */
  clearError(type: LoadingType): void {
    this.states[type] = { ...DEFAULT_STATE };
    this.retryCallbacks.delete(type);
    this.notifyListeners();
  }

  /**
   * Retry the failed operation
   */
  retry(type: LoadingType): void {
    const callbacks = this.retryCallbacks.get(type);
    if (callbacks && callbacks.length > 0) {
      // Clear error state first
      this.clearError(type);
      // Execute the most recent retry callback (callbacks.length > 0 checked above).
      const callback = callbacks[callbacks.length - 1]!;
      callback();
    }
  }

  /**
   * Reset all loading states
   */
  resetAll(): void {
    this.states = { ...DEFAULT_STATES };
    this.retryCallbacks.clear();
    this.notifyListeners();
  }

  /**
   * Subscribe to loading state changes
   */
  subscribe(listener: LoadingListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.getStates());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribe to error events
   */
  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const states = this.getStates();
    this.listeners.forEach(listener => listener(states));
  }

  private notifyErrorListeners(type: LoadingType, error: string, retryable: boolean): void {
    this.errorListeners.forEach(listener => listener(type, error, retryable));
  }
}

// Singleton instance
export const loadingStateManager = new LoadingStateManager();

// Convenience hooks will be in useLoadingState.ts
export default loadingStateManager;
