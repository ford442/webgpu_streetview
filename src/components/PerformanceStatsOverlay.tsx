/** @fileoverview Performance statistics overlay component */
import React from 'react';
import { 
  PerformanceMonitorState, 
  getPerformanceOverlayStyles, 
  getFPSColor
} from '../hooks/usePerformanceMonitor';
import { MemoryStats, MemoryProfiler } from '../utils/memoryProfiler';
import type { GpuPassTimings } from '../renderer/gpuPassTimingStore';

interface PerformanceStatsOverlayProps {
  fpsStats: PerformanceMonitorState;
  memoryStats?: MemoryStats;
  gpuPassTimings?: GpuPassTimings;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  visible?: boolean;
  showMemory?: boolean;
  onToggle?: () => void;
}

/**
 * Performance statistics overlay component
 * Displays FPS, frame times, quality level, and memory usage
 */
export const PerformanceStatsOverlay: React.FC<PerformanceStatsOverlayProps> = ({
  fpsStats,
  memoryStats,
  gpuPassTimings,
  position = 'top-left',
  visible = true,
  showMemory = true,
  onToggle
}) => {
  if (!visible) return null;
  
  const styles = getPerformanceOverlayStyles(position);
  const fpsColor = getFPSColor(fpsStats.fps.current);
  
  // Calculate memory info
  const memoryInfo = showMemory && memoryStats?.current
    ? {
        used: MemoryProfiler.formatBytes(memoryStats.current.estimatedBytes),
        peak: MemoryProfiler.formatBytes(memoryStats.peak.estimatedBytes),
        geometries: memoryStats.current.geometryCount,
        textures: memoryStats.current.textureCount
      }
    : null;
  
  // Check for memory leaks
  const hasLeaks = memoryStats?.leaks && memoryStats.leaks.length > 0;
  
  return (
    <div 
      style={styles}
      onClick={onToggle}
      title="Click to toggle performance overlay"
    >
      <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#ffffff' }}>
        ⚡ Performance Stats
      </div>
      
      <div style={{ marginBottom: '6px' }}>
        <span style={{ color: fpsColor, fontWeight: 'bold' }}>
          FPS: {fpsStats.fps.current}
        </span>
        <span style={{ color: '#888888', fontSize: '10px' }}>
          {' '} [{fpsStats.fps.min}-{fpsStats.fps.max}]
        </span>
      </div>
      
      <div style={{ marginBottom: '4px', color: '#cccccc' }}>
        Avg: {fpsStats.fps.average} | Frame: {fpsStats.fps.frameTime.toFixed(2)}ms
      </div>
      
      <div style={{ marginBottom: '4px' }}>
        Quality: {' '}
        <span style={{ 
          color: fpsStats.quality === 'high' ? '#00ff00' : 
                fpsStats.quality === 'medium' ? '#ffff00' : '#ff0000',
          fontWeight: 'bold'
        }}>
          {fpsStats.quality.toUpperCase()}
        </span>
      </div>
      
      <div style={{ marginBottom: '8px', color: '#ff6666' }}>
        Dropped Frames: {fpsStats.droppedFrames}
      </div>

      {gpuPassTimings?.available && (
        <>
          <hr style={{
            border: 'none',
            borderTop: '1px solid #444',
            margin: '8px 0',
          }} />
          <div style={{ marginBottom: '6px', fontWeight: 'bold', color: '#ffffff' }}>
            GPU passes
          </div>
          <div style={{ marginBottom: '4px', color: '#cccccc' }}>
            Pass1: {gpuPassTimings.pass1Ms != null ? `${gpuPassTimings.pass1Ms.toFixed(2)}ms` : '—'}
          </div>
          <div style={{ marginBottom: '4px', color: '#cccccc' }}>
            Weather: {gpuPassTimings.weatherMs != null ? `${gpuPassTimings.weatherMs.toFixed(2)}ms` : '—'}
          </div>
          {gpuPassTimings.blitMs != null && (
            <div style={{ marginBottom: '4px', color: '#cccccc' }}>
              Blit: {gpuPassTimings.blitMs.toFixed(2)}ms
            </div>
          )}
        </>
      )}
      
      {memoryInfo && (
        <>
          <hr style={{ 
            border: 'none', 
            borderTop: '1px solid #444', 
            margin: '8px 0' 
          }} />
          
          <div style={{ marginBottom: '6px', fontWeight: 'bold', color: '#ffffff' }}>
            💾 Memory
          </div>
          
          <div style={{ marginBottom: '4px', color: '#cccccc' }}>
            Used: {memoryInfo.used}
          </div>
          
          <div style={{ marginBottom: '4px', color: '#cccccc' }}>
            Peak: {memoryInfo.peak}
          </div>
          
          <div style={{ marginBottom: '4px', color: '#888888', fontSize: '10px' }}>
            Geo: {memoryInfo.geometries} | Tex: {memoryInfo.textures}
          </div>
        </>
      )}
      
      {hasLeaks && (
        <div style={{ 
          marginTop: '8px', 
          padding: '4px', 
          backgroundColor: 'rgba(255, 0, 0, 0.3)',
          borderRadius: '2px',
          color: '#ff6666',
          fontSize: '10px'
        }}>
          ⚠️ Memory Leak Detected!
          {memoryStats!.leaks.map((leak, i) => (
            <div key={i}>
              {leak.type}: +{leak.delta}
            </div>
          ))}
        </div>
      )}
      
      <div style={{ 
        marginTop: '8px', 
        fontSize: '9px', 
        color: '#666666',
        textAlign: 'center'
      }}>
        Click to hide
      </div>
    </div>
  );
};

export default PerformanceStatsOverlay;
