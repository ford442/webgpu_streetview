import React, { useRef } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import WebGPUCanvas from '../components/WebGPUCanvas';
import Compass from '../components/Compass';
import MiniMap from '../components/MiniMap';
import FreeLookInputHandler from '../components/FreeLookInputHandler';

interface FreeLookViewProps {
  mapsApiKey: string;
  onWebGPUStatus?: (available: boolean) => void;
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
const FreeLookView: React.FC<FreeLookViewProps> = ({ mapsApiKey, onWebGPUStatus }) => {
  const { canvas, heading, pitch, zoom, panorama } = useStreetView();
  const containerRef = useRef<HTMLDivElement>(null);
  
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* Input handler - scoped to this container */}
      <FreeLookInputHandler targetRef={containerRef} />
      
      {/* Main WebGPU canvas */}
      <WebGPUCanvas
        mode="streetview"
        source={canvas}
        zoom={zoom}
        panX={0.5}
        panY={0.5}
        isCarMode={false}
        onWebGPUStatus={onWebGPUStatus}
      />
      
      {/* Compass overlay */}
      <Compass heading={heading} />
      
      {/* MiniMap overlay */}
      {panorama && (
        <MiniMap
          apiKey={mapsApiKey}
          panorama={panorama}
          heading={heading}
        />
      )}
    </div>
  );
};

export default FreeLookView;
