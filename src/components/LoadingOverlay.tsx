/**
 * LoadingOverlay.tsx - Loading spinner and progress indicator component
 * 
 * Features:
 * - Animated spinner with smooth rotation
 * - Progress bar with percentage
 * - Error display with retry button
 * - Fade in/out transitions
 * - Multiple visual variants
 */

import React, { useEffect, useState } from 'react';
import { LoadingType, loadingStateManager } from '../store/loadingState';
import { useFadeTransition, easings } from '../hooks/useTransition';

export interface LoadingOverlayProps {
  /** Message to display below the spinner */
  message?: string;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Whether to show the overlay */
  isVisible?: boolean;
  /** Size variant */
  size?: 'small' | 'medium' | 'large' | 'fullscreen';
  /** Visual variant */
  variant?: 'spinner' | 'dots' | 'pulse' | 'bars';
  /** Custom className */
  className?: string;
  /** Error message to display */
  error?: string;
  /** Whether error is retryable */
  retryable?: boolean;
  /** Callback when retry is clicked */
  onRetry?: () => void;
  /** Loading type for state management integration */
  type?: LoadingType;
  /** Auto-connect to loading state manager */
  autoConnect?: boolean;
}

/**
 * Loading Spinner Component with multiple variants
 */
export const LoadingSpinner: React.FC<{ 
  variant?: LoadingOverlayProps['variant']; 
  size?: LoadingOverlayProps['size'];
  color?: string;
}> = ({ variant = 'spinner', size = 'medium', color = '#4CAF50' }) => {
  const getSize = () => {
    switch (size) {
      case 'small': return { width: 24, height: 24 };
      case 'large': return { width: 64, height: 64 };
      case 'fullscreen': return { width: 80, height: 80 };
      default: return { width: 40, height: 40 };
    }
  };

  const { width, height } = getSize();

  if (variant === 'dots') {
    return (
      <div className="loading-dots" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: width / 3.5,
              height: width / 3.5,
              backgroundColor: color,
              borderRadius: '50%',
              animation: `loadingBounce 0.6s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === 'pulse') {
    return (
      <div
        style={{
          width,
          height,
          backgroundColor: color,
          borderRadius: '50%',
          animation: 'loadingPulse 1.5s ease-in-out infinite',
        }}
      />
    );
  }

  if (variant === 'bars') {
    return (
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              width: width / 6,
              height: '100%',
              backgroundColor: color,
              animation: `loadingBar 1s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  // Default spinner
  return (
    <div
      style={{
        width,
        height,
        border: `${width / 8}px solid rgba(255, 255, 255, 0.1)`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'loadingSpin 0.8s linear infinite',
      }}
    />
  );
};

/**
 * Progress Bar Component
 */
export const ProgressBar: React.FC<{
  progress: number;
  showPercentage?: boolean;
  color?: string;
  height?: number;
}> = ({ progress, showPercentage = true, color = '#4CAF50', height = 6 }) => {
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div style={{ width: '100%', maxWidth: 280 }}>
      <div
        style={{
          width: '100%',
          height,
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
          borderRadius: height / 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${clampedProgress}%`,
            height: '100%',
            backgroundColor: color,
            borderRadius: height / 2,
            transition: 'width 0.15s ease-out',
            boxShadow: `0 0 10px ${color}40`,
          }}
        />
      </div>
      {showPercentage && (
        <div
          style={{
            textAlign: 'center',
            marginTop: 8,
            fontSize: 13,
            color: 'rgba(255, 255, 255, 0.7)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {Math.round(clampedProgress)}%
        </div>
      )}
    </div>
  );
};

/**
 * Error Display Component with Retry
 */
export const ErrorDisplay: React.FC<{
  message: string;
  retryable?: boolean;
  onRetry?: () => void;
}> = ({ message, retryable = false, onRetry }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        padding: 20,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          backgroundColor: 'rgba(244, 67, 54, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
        }}
      >
        ⚠️
      </div>
      <div
        style={{
          color: '#ff5252',
          fontSize: 14,
          textAlign: 'center',
          maxWidth: 280,
          lineHeight: 1.5,
        }}
      >
        {message}
      </div>
      {retryable && onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '10px 24px',
            backgroundColor: 'rgba(244, 67, 54, 0.8)',
            color: '#fff',
            border: 'none',
            borderRadius: 20,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(244, 67, 54, 1)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(244, 67, 54, 0.8)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
};

/**
 * Main Loading Overlay Component
 */
export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  message = 'Loading...',
  progress,
  isVisible = true,
  size = 'fullscreen',
  variant = 'spinner',
  className = '',
  error,
  retryable = false,
  onRetry,
  type,
  autoConnect = false,
}) => {
  const [managedState, setManagedState] = useState<{
    isLoading: boolean;
    message: string;
    progress?: number;
    error?: string;
    retryable?: boolean;
  } | null>(null);

  const fadeTransition = useFadeTransition({
    duration: 300,
    easing: easings.easeInOut,
  });

  // Auto-connect to loading state manager if type is provided
  useEffect(() => {
    if (!autoConnect || !type) return;

    const unsubscribe = loadingStateManager.subscribe((states) => {
      const state = states[type];
      setManagedState(state);
    });

    return unsubscribe;
  }, [autoConnect, type]);

  // Use managed state or props
  const displayState = autoConnect && managedState ? {
    isVisible: managedState.isLoading || Boolean(managedState.error),
    message: managedState.message,
    progress: managedState.progress,
    error: managedState.error,
    retryable: managedState.retryable,
    onRetry: () => loadingStateManager.retry(type!),
  } : {
    isVisible,
    message,
    progress,
    error,
    retryable,
    onRetry,
  };

  // Handle visibility changes with fade
  useEffect(() => {
    fadeTransition.toggle(displayState.isVisible);
  }, [displayState.isVisible]);

  // Don't render if not visible and fade is complete
  if (fadeTransition.opacity <= 0.01 && !displayState.isVisible) {
    return null;
  }

  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          width: 'auto',
          minWidth: 120,
          padding: '16px 20px',
          borderRadius: 12,
        };
      case 'medium':
        return {
          width: 'auto',
          minWidth: 200,
          padding: '24px 32px',
          borderRadius: 16,
        };
      case 'large':
        return {
          width: 'auto',
          minWidth: 280,
          padding: '32px 40px',
          borderRadius: 20,
        };
      case 'fullscreen':
      default:
        return {
          width: '100vw',
          height: '100vh',
          padding: 40,
          borderRadius: 0,
        };
    }
  };

  const sizeStyles = getSizeStyles();

  return (
    <div
      className={`loading-overlay ${className}`}
      style={{
        position: size === 'fullscreen' ? 'fixed' : 'absolute',
        top: 0,
        left: 0,
        ...sizeStyles,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        backgroundColor: size === 'fullscreen' 
          ? `rgba(0, 0, 0, ${0.85 * fadeTransition.opacity})` 
          : `rgba(30, 30, 30, ${0.95 * fadeTransition.opacity})`,
        backdropFilter: size === 'fullscreen' ? `blur(8px)` : 'blur(4px)',
        zIndex: 9999,
        opacity: fadeTransition.opacity,
        transition: 'opacity 0.3s ease',
        pointerEvents: fadeTransition.opacity > 0.5 ? 'auto' : 'none',
      }}
    >
      {displayState.error ? (
        <ErrorDisplay
          message={displayState.error}
          retryable={displayState.retryable}
          onRetry={displayState.onRetry}
        />
      ) : (
        <>
          <LoadingSpinner variant={variant} size={size === 'fullscreen' ? 'large' : size} />
          
          <div
            style={{
              color: '#fff',
              fontSize: size === 'small' ? 13 : 15,
              fontWeight: 500,
              textAlign: 'center',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
              maxWidth: 320,
              lineHeight: 1.4,
            }}
          >
            {displayState.message}
          </div>

          {typeof displayState.progress === 'number' && (
            <ProgressBar 
              progress={displayState.progress} 
              color="#4CAF50"
            />
          )}
        </>
      )}

      {/* CSS Animations */}
      <style>{`
        @keyframes loadingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes loadingBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes loadingPulse {
          0% { transform: scale(0.8); opacity: 0.5; }
          50% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.8); opacity: 0.5; }
        }
        @keyframes loadingBar {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
};

/**
 * Hook for using loading overlay with automatic state management
 */
export function useLoadingOverlay(type: LoadingType) {
  const [state, setState] = useState({
    isLoading: false,
    message: '',
    progress: undefined as number | undefined,
    error: undefined as string | undefined,
    retryable: false,
  });

  useEffect(() => {
    const unsubscribe = loadingStateManager.subscribe((states) => {
      const loadingState = states[type];
      setState({
        isLoading: loadingState.isLoading,
        message: loadingState.message,
        progress: loadingState.progress,
        error: loadingState.error,
        retryable: loadingState.retryable ?? false,
      });
    });

    return unsubscribe;
  }, [type]);

  return {
    ...state,
    startLoading: (message: string, progress?: number) => 
      loadingStateManager.startLoading(type, message, progress),
    updateProgress: (progress: number, message?: string) => 
      loadingStateManager.updateProgress(type, progress, message),
    stopLoading: () => loadingStateManager.stopLoading(type),
    setError: (error: string, retryable?: boolean, retryCallback?: () => void) => 
      loadingStateManager.setError(type, error, retryable, retryCallback),
    retry: () => loadingStateManager.retry(type),
  };
}

export default LoadingOverlay;
