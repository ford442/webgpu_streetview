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

import React, { useEffect, useId } from 'react';
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
  /** Heading of the error card */
  errorTitle?: string;
  /** What the user can do next, under the error */
  errorHint?: string;
  /** Label of the recovery button (default "Try again") */
  retryLabel?: string;
  /** Whether error is retryable */
  retryable?: boolean;
  /** Callback when retry is clicked */
  onRetry?: () => void;
}

/**
 * Loading Spinner Component with multiple variants
 */
const LoadingSpinner: React.FC<{ 
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
const ProgressBar: React.FC<{
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
 * Error Display Component with Retry — a designed card (#385): icon, heading,
 * the message, a next-step hint and one recovery action. Plain text only; a
 * probe reason may follow the message in parentheses, never a stack trace.
 */
const ErrorDisplay: React.FC<{
  message: string;
  title?: string | undefined;
  hint?: string | undefined;
  retryLabel?: string | undefined;
  retryable?: boolean;
  onRetry?: (() => void) | undefined;
}> = ({ message, title, hint, retryLabel = 'Try again', retryable = false, onRetry }) => {
  const id = useId();
  return (
    <div
      // A labelled group, not role="alert" (the banners own that, and e2e filters on it) and
      // not an alertdialog (the overlay is not a modal — App.test.tsx holds that).
      role="group"
      aria-labelledby={title ? `${id}-title` : `${id}-msg`}
      aria-describedby={`${id}-msg`}
      data-testid="error-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: 440,
        padding: '28px 24px',
        borderRadius: 16,
        background: 'rgba(24, 24, 28, 0.96)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflowWrap: 'anywhere',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          backgroundColor: 'rgba(255, 138, 101, 0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
        }}
      >
        ⚠️
      </div>
      {title && (
        <h2 id={`${id}-title`} style={{ margin: 0, color: '#fff', fontSize: 19, fontWeight: 650, lineHeight: 1.3 }}>
          {title}
        </h2>
      )}
      <p
        id={`${id}-msg`}
        style={{
          margin: 0,
          // #ffab91 on the card is ~9:1 — WCAG AA for small text with room to spare.
          color: title ? '#e0e0e0' : '#ffab91',
          fontSize: 14,
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
      {hint && (
        <p style={{ margin: 0, color: '#bdbdbd', fontSize: 13, textAlign: 'center', lineHeight: 1.45 }}>
          {hint}
        </p>
      )}
      {retryable && onRetry && (
        <button
          type="button"
          className="sv-error-action"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          {retryLabel}
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
  errorTitle,
  errorHint,
  retryLabel,
  retryable = false,
  onRetry,
}) => {
  const fadeTransition = useFadeTransition({
    duration: 300,
    easing: easings.easeInOut,
  });
  const fadeOpacity = fadeTransition.opacity;
  const toggleFade = fadeTransition.toggle;

  const displayState = {
    isVisible,
    message,
    progress,
    error,
    retryable,
    onRetry,
  };

  // Handle visibility changes with fade
  useEffect(() => {
    toggleFade(displayState.isVisible);
  }, [displayState.isVisible, toggleFade]);

  // Don't render if not visible and fade is complete
  if (fadeOpacity <= 0.01 && !displayState.isVisible) {
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
        // `inset: 0` + border-box, not 100vw/100vh + padding: that was 80px wider and taller
        // than the viewport (a horizontal overflow at every width, #385).
        return {
          right: 0,
          bottom: 0,
          boxSizing: 'border-box' as const,
          padding: 'max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
          overflowY: 'auto' as const,
          borderRadius: 0,
        };
    }
  };

  const sizeStyles = getSizeStyles();

  return (
    <div
      className={`loading-overlay${size === 'fullscreen' ? ' loading-overlay--fullscreen' : ''} ${className}`}
      // UI overlays never leak input to the Maps / WebGPU canvas underneath.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
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
          ? `rgba(0, 0, 0, ${0.85 * fadeOpacity})` 
          : `rgba(30, 30, 30, ${0.95 * fadeOpacity})`,
        backdropFilter: size === 'fullscreen' ? `blur(8px)` : 'blur(4px)',
        zIndex: 9999,
        opacity: fadeOpacity,
        transition: 'opacity 0.3s ease',
        pointerEvents: fadeOpacity > 0.5 ? 'auto' : 'none',
      }}
    >
      {displayState.error ? (
        <ErrorDisplay
          message={displayState.error}
          title={errorTitle}
          hint={errorHint}
          retryLabel={retryLabel}
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

