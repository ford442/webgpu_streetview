import React from 'react';

const HelpItem: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#ccc' }}>
    <span style={{ fontSize: '24px', width: '40px', textAlign: 'center' }}>{icon}</span>
    <span style={{ fontSize: '14px' }}>{text}</span>
  </div>
);

interface MobileHelpSheetProps {
  onClose: () => void;
}

export const MobileHelpSheet: React.FC<MobileHelpSheetProps> = ({ onClose }) => (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}
    onClick={onClose}
  >
    <div
      style={{
        background: '#1a1a1a',
        borderRadius: '16px',
        padding: '24px',
        width: '100%',
        maxWidth: '360px',
        maxHeight: '80vh',
        overflow: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 style={{ margin: '0 0 20px', color: '#fff', fontSize: '20px' }}>How to Use</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <HelpItem icon="👆" text="Drag to look around" />
        <HelpItem icon="👌" text="Pinch to zoom in/out" />
        <HelpItem icon="👆👆" text="Double tap to take a photo" />
        <HelpItem icon="▲▼◀▶" text="Use D-pad to move" />
        <HelpItem icon="🚗" text="Tap Car for interior view" />
        <HelpItem icon="🗺️" text="Tap Map to see your location" />
      </div>

      <button
        onClick={onClose}
        style={{
          width: '100%',
          marginTop: '24px',
          padding: '12px',
          background: '#2196F3',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '14px',
          cursor: 'pointer',
        }}
      >
        Got it!
      </button>
    </div>
  </div>
);
