import React, { useEffect, useState } from 'react';
import { RendererBackendType, RendererEffectIsolation } from '../renderer/RendererBackend';

export interface RendererBackendInfo {
  backendType: RendererBackendType | null;
  fallbackReason?: string;
}

interface RendererBackendIndicatorProps {
  backendInfo: RendererBackendInfo | null;
}

const EFFECT_OPTIONS: RendererEffectIsolation[] = ['all', 'raw', 'color', 'weather', 'fog', 'night', 'lighting'];

const chipStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '10px',
  left: '10px',
  zIndex: 105,
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  color: '#00ff00',
  fontFamily: 'monospace',
  fontSize: '11px',
  padding: '6px 10px',
  borderRadius: '4px',
  border: '1px solid #333',
  cursor: 'pointer',
  userSelect: 'none',
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '38px',
  left: '10px',
  zIndex: 105,
  backgroundColor: 'rgba(0, 0, 0, 0.85)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: '11px',
  padding: '10px',
  borderRadius: '4px',
  border: '1px solid #333',
  minWidth: '180px',
};

const switchButtonStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '4px 6px',
  marginRight: '4px',
  fontSize: '11px',
  fontFamily: 'monospace',
  border: `1px solid ${active ? '#00ff00' : '#555'}`,
  borderRadius: '3px',
  backgroundColor: active ? 'rgba(0,255,0,0.15)' : 'rgba(255,255,255,0.05)',
  color: active ? '#00ff00' : '#ccc',
  cursor: 'pointer',
});

interface DeviceDiagnostics {
  featureLevel: string;
  forceFallbackAdapter: boolean;
  colorSpace: string;
  toneMapping: string;
  uncapturedErrorCount: number;
  lastUncapturedError?: string;
  canvasDowngradeReason?: string;
}

function readDeviceDiagnostics(): DeviceDiagnostics | null {
  const matrix = window.rendererAdapterInfo?.capabilityMatrix;
  if (!matrix) return null;
  return {
    featureLevel: matrix.featureLevel,
    forceFallbackAdapter: matrix.forceFallbackAdapter,
    colorSpace: matrix.canvasColorSpace,
    toneMapping: matrix.canvasToneMapping,
    uncapturedErrorCount: matrix.uncapturedErrorCount,
    lastUncapturedError: matrix.lastUncapturedError,
    canvasDowngradeReason: matrix.canvasDowngradeReason,
  };
}

function chipLabel(info: RendererBackendInfo): string {
  if (info.backendType === 'webgpu') return 'WebGPU';
  if (info.backendType === 'webgl') return 'WebGL2 (fallback)';
  return 'Raw fallback';
}

export const RendererBackendIndicator: React.FC<RendererBackendIndicatorProps> = ({ backendInfo }) => {
  const [expanded, setExpanded] = useState(false);
  const [effectIsolation, setEffectIsolation] = useState<RendererEffectIsolation>(
    () => window.streetViewRendererDebug?.getDebugOptions().effectIsolation ?? 'all'
  );
  const [wireframe, setWireframe] = useState<boolean>(
    () => window.streetViewRendererDebug?.getDebugOptions().wireframe ?? false
  );
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnostics | null>(null);

  const isWebGPU = backendInfo?.backendType === 'webgpu';

  // Uncaptured errors accumulate after init, so poll the matrix while the panel is open.
  useEffect(() => {
    if (!expanded || !isWebGPU) return undefined;
    setDiagnostics(readDeviceDiagnostics());
    const timer = window.setInterval(() => setDiagnostics(readDeviceDiagnostics()), 1000);
    return () => window.clearInterval(timer);
  }, [expanded, isWebGPU]);

  if (!backendInfo) return null;

  const isWebGL = backendInfo.backendType === 'webgl';

  return (
    <>
      {expanded && (
        <div style={panelStyle} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', marginBottom: '4px' }}>
            <button
              style={switchButtonStyle(backendInfo.backendType === 'webgpu')}
              onClick={() => window.streetViewRendererDebug?.setBackend('webgpu')}
            >
              WebGPU
            </button>
            <button
              style={{ ...switchButtonStyle(backendInfo.backendType === 'webgl'), marginRight: 0 }}
              onClick={() => window.streetViewRendererDebug?.setBackend('webgl')}
            >
              WebGL2
            </button>
          </div>
          <div style={{ color: '#888', fontSize: '9px', marginBottom: isWebGL ? '8px' : 0 }}>
            (reloads page)
          </div>

          {diagnostics && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '6px 0' }} />
              <div style={{ color: '#ccc', fontSize: '10px', lineHeight: 1.5 }}>
                <div>
                  featureLevel: {diagnostics.featureLevel}
                  {diagnostics.forceFallbackAdapter ? ' (fallback adapter)' : ''}
                </div>
                <div>canvas: {diagnostics.colorSpace} / {diagnostics.toneMapping}</div>
                {diagnostics.canvasDowngradeReason && (
                  <div style={{ color: '#ffcc66' }} title={diagnostics.canvasDowngradeReason}>
                    canvas downgraded to SDR
                  </div>
                )}
                <div style={{ color: diagnostics.uncapturedErrorCount > 0 ? '#ff6666' : '#ccc' }}>
                  uncaptured errors: {diagnostics.uncapturedErrorCount}
                </div>
                {diagnostics.lastUncapturedError && (
                  <div
                    style={{
                      color: '#ff6666',
                      maxWidth: '220px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={diagnostics.lastUncapturedError}
                  >
                    {diagnostics.lastUncapturedError}
                  </div>
                )}
              </div>
            </>
          )}

          {isWebGL && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '6px 0' }} />
              <label style={{ display: 'block', marginBottom: '6px', color: '#ccc' }}>
                Effect isolation
                <select
                  value={effectIsolation}
                  onChange={e => {
                    const next = e.target.value as RendererEffectIsolation;
                    setEffectIsolation(next);
                    window.streetViewRendererDebug?.setEffectIsolation(next);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: '2px',
                    backgroundColor: '#111',
                    color: '#fff',
                    border: '1px solid #555',
                    borderRadius: '3px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                  }}
                >
                  {EFFECT_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                <input
                  type="checkbox"
                  checked={wireframe}
                  onChange={e => {
                    const next = e.target.checked;
                    setWireframe(next);
                    window.streetViewRendererDebug?.setWireframe(next);
                  }}
                />
                Wireframe
              </label>
            </>
          )}
        </div>
      )}
      <div
        style={chipStyle}
        onClick={() => setExpanded(v => !v)}
        title={backendInfo.fallbackReason || 'Click to toggle renderer backend controls'}
      >
        {chipLabel(backendInfo)}
      </div>
    </>
  );
};

export default RendererBackendIndicator;
