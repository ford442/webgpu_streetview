import React from 'react';

const BUILD_VERSION = process.env.REACT_APP_BUILD_VERSION || 'dev';
const BUILD_TIME = process.env.REACT_APP_BUILD_TIME || '';

const BuildBadge: React.FC = () => (
  <div
    title={BUILD_TIME ? `Built ${BUILD_TIME}` : 'Development build'}
    style={{
      position: 'fixed',
      bottom: 6,
      right: 8,
      zIndex: 9999,
      fontFamily: 'monospace',
      fontSize: 10,
      color: 'rgba(255,255,255,0.35)',
      letterSpacing: '0.04em',
      pointerEvents: 'none',
      userSelect: 'none',
    }}
  >
    {BUILD_VERSION}
  </div>
);

export default BuildBadge;
