import React, { useRef } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import Compass from '../components/Compass';
import FreeLookInputHandler from '../components/FreeLookInputHandler';

interface FreeLookViewProps {
  mapsApiKey: string;
}

/**
 * FreeLookView - The standard walking/Street View experience.
 * 
 * Features:
 * - Full-screen WebGPU Street View rendering
 * - Mouse drag to look around
 * - WASD/Arrow keys to move
 * - Scroll to zoom
 * - 'C' key to toggle to car mode
 * - Compass and MiniMap overlays
 */
const FreeLookView: React.FC<FreeLookViewProps> = ({ mapsApiKey: _mapsApiKey }) => {
  const { heading } = useStreetView();
  const containerRef = useRef<HTMLDivElement>(null);
  
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'transparent',
      }}
    >
      {/* Input handler - scoped to this container */}
      <FreeLookInputHandler targetRef={containerRef} />
      
      {/* Compass overlay */}
      <Compass heading={heading} />
      
      {/* MiniMap deferred — a full-viewport Map instance doubles API quota usage
          and contributed to OverQuotaMapError flicker. Re-enable via map panel later. */}
    </div>
  );
}

export default FreeLookView;
