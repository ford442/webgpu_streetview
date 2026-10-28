/** @fileoverview Performance statistics overlay component */
import React from 'react';
import { useFrameRateStats } from '../renderer/perfStore';
import { getActiveQualityLevel } from '../config/visualPresets';
import { type MemoryStats, MemoryProfiler } from '../utils/memoryProfiler';
import type { GpuPassTimings } from '../renderer/gpuPassTimingStore';
import type { GpuChoresStats } from '../renderer/gpuChores/gpuChoresStatsStore';
import { exposureHintFromMeanLuma } from '../renderer/gpuChores/lumaMath';
import type { AutoExposureStatus } from '../renderer/autoExposure';
import { useSceneDepthStats } from '../renderer/depth/sceneDepthStatsStore';
import type { AppliedRenderScale } from '../renderer/renderScale';

type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function getPerformanceOverlayStyles(position: OverlayPosition = 'top-left'): React.CSSProperties {
  const baseStyles: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    color: '#00ff00',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '10px',
    borderRadius: '4px',
    pointerEvents: 'none',
    userSelect: 'none',
    minWidth: '150px'
  };
  switch (position) {
    case 'top-left':
      return { ...baseStyles, top: '10px', left: '10px' };
    case 'top-right':
      return { ...baseStyles, top: '10px', right: '10px' };
    case 'bottom-left':
      return { ...baseStyles, bottom: '10px', left: '10px' };
    case 'bottom-right':
      return { ...baseStyles, bottom: '10px', right: '10px' };
  }
}

function getFPSColor(fps: number, targetFPS: number = 60): string {
  const ratio = fps / targetFPS;
  if (ratio >= 0.9) return '#00ff00'; // Green
  if (ratio >= 0.7) return '#ffff00'; // Yellow
  if (ratio >= 0.5) return '#ff8800'; // Orange
  return '#ff0000'; // Red
}

/**
 * Frame rate rows. Subscribes to `perfStore` itself (published by the frame
 * driver twice a second), so the rest of the overlay does not re-render with it.
 */
const FrameRateRows: React.FC = () => {
  const measured = useFrameRateStats((s) => s.measured);
  const fps = useFrameRateStats((s) => s.fps);
  const fpsMin = useFrameRateStats((s) => s.fpsMin);
  const fpsMax = useFrameRateStats((s) => s.fpsMax);
  const frameTimeMs = useFrameRateStats((s) => s.frameTimeMs);
  const slowFrames = useFrameRateStats((s) => s.slowFrames);
  if (!measured) {
    return <div style={{ marginBottom: '6px', color: '#888888' }}>FPS: —</div>;
  }
  return (
    <>
      <div style={{ marginBottom: '6px' }} data-testid="perf-fps">
        <span style={{ color: getFPSColor(fps), fontWeight: 'bold' }}>
          FPS: {fps}
        </span>
        <span style={{ color: '#888888', fontSize: '10px' }}>
          {' '} [{fpsMin}-{fpsMax}]
        </span>
      </div>
      <div style={{ marginBottom: '4px', color: '#cccccc' }}>
        Frame: {frameTimeMs.toFixed(2)}ms
      </div>
      <div style={{ marginBottom: '8px', color: '#ff6666' }}>
        Slow frames: {slowFrames}
      </div>
    </>
  );
};

interface PerformanceStatsOverlayProps {
  memoryStats?: MemoryStats;
  gpuPassTimings?: GpuPassTimings;
  gpuChoresStats?: GpuChoresStats;
  autoExposureStatus?: AutoExposureStatus;
  renderScale?: AppliedRenderScale;
  position?: OverlayPosition;
  visible?: boolean;
  showMemory?: boolean;
  onToggle?: () => void;
}

function formatAutoExposureState(status: AutoExposureStatus | undefined): string {
  if (!status?.enabled) return '(auto off)';
  if (status.appliedEv == null) return '(auto on)';
  const ev = `${status.appliedEv >= 0 ? '+' : ''}${status.appliedEv.toFixed(2)}`;
  return status.holdActive ? `(auto held ${ev})` : `(auto → ${ev})`;
}

const UPSCALE_LABEL: Record<AppliedRenderScale['upscale'], string> = {
  fsr: 'FSR 1.0',
  bilinear: 'bilinear',
  none: 'native',
};

/** `0.75× auto · over-budget`, or `1.00× fixed · flag`. */
export function formatRenderScale(s: AppliedRenderScale): string {
  const why = s.frozen ? 'held' : s.limitedBy ?? s.reason;
  return `${s.scale.toFixed(2)}× ${s.mode} · ${why}`;
}

/** Render scale (#329): what the road rendered at, the range, how it reached the screen. */
const RenderScaleRows: React.FC<{ renderScale: AppliedRenderScale }> = ({ renderScale: s }) => (
  <>
    <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '8px 0' }} />
    <div style={{ marginBottom: '6px', fontWeight: 'bold', color: '#ffffff' }}>
      Render scale
    </div>
    <div style={{ marginBottom: '4px', color: '#cccccc' }} data-testid="perf-render-scale">
      {formatRenderScale(s)}
    </div>
    <div style={{ marginBottom: '4px', color: '#888888', fontSize: '10px' }}>
      {s.width}×{s.height} → {s.outputWidth}×{s.outputHeight} · {UPSCALE_LABEL[s.upscale]}
      {s.mode === 'auto' ? ` · ${s.min.toFixed(2)}–${s.max.toFixed(2)}` : ''}
    </div>
  </>
);

/**
 * Scene depth (#320): inference time and cadence. Subscribes to its own store,
 * so a 5 Hz depth update re-renders these rows only.
 */
const SceneDepthStatsRows: React.FC = () => {
  const state = useSceneDepthStats((s) => s.state);
  const reason = useSceneDepthStats((s) => s.reason);
  const variant = useSceneDepthStats((s) => s.variant);
  const inferenceMs = useSceneDepthStats((s) => s.inferenceMs);
  const cadenceHz = useSceneDepthStats((s) => s.cadenceHz);
  const inputWidth = useSceneDepthStats((s) => s.inputWidth);
  const inputHeight = useSceneDepthStats((s) => s.inputHeight);
  const appliedBlend = useSceneDepthStats((s) => s.appliedBlend);
  if (state === 'off') return null;
  return (
    <>
      <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '8px 0' }} />
      <div style={{ marginBottom: '6px', fontWeight: 'bold', color: '#ffffff' }}>
        Scene depth
      </div>
      <div style={{ marginBottom: '4px', color: '#cccccc' }} data-testid="perf-scene-depth">
        {state === 'ready'
          ? `${inferenceMs != null ? `${inferenceMs.toFixed(0)}ms` : '—'} · ${cadenceHz.toFixed(1)} Hz · w ${appliedBlend.toFixed(2)}`
          : state === 'loading' ? 'loading…' : `failed: ${reason ?? '—'}`}
      </div>
      {state === 'ready' && (
        <div style={{ marginBottom: '4px', color: '#888888', fontSize: '10px' }}>
          {variant ?? '—'} · {inputWidth}×{inputHeight}
        </div>
      )}
    </>
  );
};

/**
 * Performance statistics overlay component
 * Displays FPS, frame times, the quality preset, and memory usage
 */
export const PerformanceStatsOverlay: React.FC<PerformanceStatsOverlayProps> = ({
  memoryStats,
  gpuPassTimings,
  gpuChoresStats,
  autoExposureStatus,
  renderScale,
  position = 'top-left',
  visible = true,
  showMemory = true,
  onToggle
}) => {
  if (!visible) return null;
  
  const styles = getPerformanceOverlayStyles(position);
  const quality = getActiveQualityLevel();
  
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
  const aeHint = gpuChoresStats?.meanLuma != null
    ? exposureHintFromMeanLuma(gpuChoresStats.meanLuma)
    : null;
  
  return (
    <div 
      style={styles}
      onClick={onToggle}
      title="Click to toggle performance overlay"
    >
      <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#ffffff' }}>
        ⚡ Performance Stats
      </div>
      
      <FrameRateRows />

      <div style={{ marginBottom: '8px', color: '#cccccc' }}>
        Quality: <span style={{ fontWeight: 'bold' }}>{quality}</span>
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
          {gpuPassTimings.upscaleMs != null && (
            <div style={{ marginBottom: '4px', color: '#cccccc' }}>
              Upscale: {gpuPassTimings.upscaleMs.toFixed(2)}ms
            </div>
          )}
        </>
      )}

      {renderScale && renderScale.outputWidth > 0 && <RenderScaleRows renderScale={renderScale} />}

      {gpuChoresStats && gpuChoresStats.backend !== 'disabled' && (
        <>
          <hr style={{
            border: 'none',
            borderTop: '1px solid #444',
            margin: '8px 0',
          }} />
          <div style={{ marginBottom: '6px', fontWeight: 'bold', color: '#ffffff' }}>
            Scene luma
          </div>
          <div style={{ marginBottom: '4px', color: '#cccccc' }}>
            Y: {gpuChoresStats.meanLuma != null ? gpuChoresStats.meanLuma.toFixed(3) : '—'}
            {gpuChoresStats.minLuma != null && gpuChoresStats.maxLuma != null
              ? `  [${gpuChoresStats.minLuma.toFixed(2)}–${gpuChoresStats.maxLuma.toFixed(2)}]`
              : ''}
          </div>
          <div style={{ marginBottom: '4px', color: '#cccccc' }}>
            AE: {aeHint != null ? `${aeHint >= 0 ? '+' : ''}${aeHint.toFixed(2)} EV` : '—'}
            {' '}
            <span style={{ color: '#888888', fontSize: '10px' }}>
              {formatAutoExposureState(autoExposureStatus)}
            </span>
          </div>
          <div style={{ marginBottom: '4px', color: '#888888', fontSize: '10px' }}>
            chores: {gpuChoresStats.backend}
            {gpuChoresStats.killSwitch ? '  kill=no_gpu_compute' : ''}
            {gpuChoresStats.sampleMs != null ? `  ${gpuChoresStats.sampleMs.toFixed(1)}ms` : ''}
          </div>
        </>
      )}
      
      <SceneDepthStatsRows />

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
