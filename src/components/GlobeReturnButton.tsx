import React from 'react';

interface GlobeReturnButtonProps {
  onClick: () => void;
  style?: React.CSSProperties;
}

/** Escape hatch while Cesium loads or globe mode is active. */
const GlobeReturnButton: React.FC<GlobeReturnButtonProps> = ({ onClick, style }) => (
  <button
    type="button"
    aria-label="Return to Street View"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    onMouseDown={(e) => e.stopPropagation()}
    onKeyDown={(e) => e.stopPropagation()}
    style={{
      padding: '10px 18px',
      backgroundColor: 'rgba(0,0,0,0.85)',
      border: '1px solid rgba(0,204,255,0.5)',
      borderRadius: 8,
      color: '#00CCFF',
      fontSize: 14,
      fontWeight: 600,
      fontFamily: 'system-ui, sans-serif',
      cursor: 'pointer',
      pointerEvents: 'auto',
      boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
      ...style,
    }}
  >
    🗺️ Return to Street View
  </button>
);

export default GlobeReturnButton;
