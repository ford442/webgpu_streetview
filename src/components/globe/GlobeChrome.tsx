import React from 'react';
import GlobeReturnButton from '../GlobeReturnButton';

interface GlobeContextFailedProps {
  onReturn: () => void;
}

export const GlobeContextFailed: React.FC<GlobeContextFailedProps> = ({ onReturn }) => (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.85)',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
      gap: 16,
    }}
  >
    <div style={{ fontSize: 48 }}>🌍</div>
    <div style={{ fontSize: 18, fontWeight: 600 }}>Globe View Unavailable</div>
    <div style={{ fontSize: 14, color: '#aaa', maxWidth: 400, textAlign: 'center' }}>
      WebGL context could not be created. This may happen if too many GPU contexts
      are active, or your browser doesn't support WebGL. Try refreshing the page.
    </div>
    <button
      onClick={onReturn}
      style={{
        marginTop: 12,
        padding: '10px 24px',
        backgroundColor: 'rgba(0,204,255,0.2)',
        border: '1px solid rgba(0,204,255,0.5)',
        borderRadius: 8,
        color: '#00CCFF',
        fontSize: 14,
        cursor: 'pointer',
      }}
    >
      Return to Street View
    </button>
  </div>
);

interface GlobeReturnHatchProps {
  onRequestExit: () => void;
}

export const GlobeReturnHatch: React.FC<GlobeReturnHatchProps> = ({ onRequestExit }) => (
  <div
    style={{
      position: 'fixed',
      top: 16,
      left: 16,
      zIndex: 210,
      pointerEvents: 'auto',
    }}
    onMouseDown={(e) => e.stopPropagation()}
    onClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => e.stopPropagation()}
  >
    <GlobeReturnButton onClick={onRequestExit} />
  </div>
);

export const GlobeModeHud: React.FC = () => (
  <div
    style={{
      position: 'fixed',
      bottom: 30,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 201,
      backgroundColor: 'rgba(0,0,0,0.72)',
      color: '#fff',
      padding: '10px 20px',
      borderRadius: '20px',
      fontSize: '13px',
      fontFamily: 'system-ui, sans-serif',
      border: '1px solid rgba(0,204,255,0.4)',
      boxShadow: '0 0 20px rgba(0,204,255,0.2)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}
  >
    <span>
      🌍 Globe Mode — <strong>click</strong> to preview | <strong>double-click</strong> to drop in |
      <strong> Shift+click</strong> to add waypoint
    </span>
    <span style={{ color: '#666' }}>|</span>
    <span>
      Press <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>Esc</kbd> or use
      <strong> Return to Street View</strong> (top-left)
    </span>
  </div>
);

export const GlobeToast: React.FC<{ message: string }> = ({ message }) => (
  <div
    style={{
      position: 'fixed',
      top: 80,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 203,
      backgroundColor: 'rgba(0,0,0,0.85)',
      color: '#FF6464',
      padding: '10px 20px',
      borderRadius: 12,
      fontSize: 14,
      fontFamily: 'system-ui, sans-serif',
      fontWeight: 600,
      border: '1px solid rgba(255,50,50,0.4)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    }}
  >
    {message}
  </div>
);

interface GlobeLoadingOverlayProps {
  onRequestExit: () => void;
}

export const GlobeLoadingOverlay: React.FC<GlobeLoadingOverlayProps> = ({ onRequestExit }) => (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
      backgroundColor: 'rgba(0,0,0,0.6)',
      color: '#fff',
      fontSize: '18px',
      fontFamily: 'system-ui, sans-serif',
    }}
    onMouseDown={(e) => e.stopPropagation()}
    onClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => e.stopPropagation()}
  >
    <div>🌍 Loading Globe…</div>
    <GlobeReturnButton onClick={onRequestExit} />
  </div>
);
