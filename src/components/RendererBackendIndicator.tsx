import React, { useEffect, useState } from 'react';
import { wantsGpuFeatureDump, type RendererBackendType } from '../renderer/RendererBackend';
import type { WebGpuProbeRecord } from '../renderer/webgpuBootProbe';

export interface RendererBackendInfo {
  backendType: RendererBackendType | null;
  fallbackReason?: string;
}

interface RendererBackendIndicatorProps {
  backendInfo: RendererBackendInfo | null;
}

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
  minWidth: '220px',
  maxWidth: '320px',
};

const switchButtonStyle = (active: boolean, disabled = false): React.CSSProperties => ({
  flex: 1,
  padding: '4px 6px',
  marginRight: '4px',
  fontSize: '11px',
  fontFamily: 'monospace',
  border: `1px solid ${active ? '#00ff00' : '#555'}`,
  borderRadius: '3px',
  backgroundColor: active ? 'rgba(0,255,0,0.15)' : 'rgba(255,255,255,0.05)',
  color: disabled ? '#666' : active ? '#00ff00' : '#ccc',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

interface DeviceDiagnostics {
  featureLevel: string;
  forceFallbackAdapter: boolean;
  colorSpace: string;
  toneMapping: string;
  uncapturedErrorCount: number;
  lastUncapturedError?: string;
  canvasDowngradeReason?: string;
  optionalFeaturesAttempted: GPUFeatureName[];
  optionalFeaturesEnabled: GPUFeatureName[];
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
    optionalFeaturesAttempted: matrix.optionalFeaturesAttempted,
    optionalFeaturesEnabled: matrix.optionalFeaturesEnabled,
  };
}

function readProbe(): WebGpuProbeRecord | null {
  return window.webgpuProbe ?? null;
}

function chipLabel(info: RendererBackendInfo): string {
  if (info.backendType === 'webgpu') return 'WebGPU';
  if (info.backendType === 'webgl') return 'WebGL2 (reference only)';
  const probe = readProbe();
  if (probe && !probe.ok) {
    return `WebGPU failed (${probe.browserBrand})`;
  }
  return 'WebGPU failed';
}

export const RendererBackendIndicator: React.FC<RendererBackendIndicatorProps> = ({ backendInfo }) => {
  const [expanded, setExpanded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnostics | null>(null);
  const [probe, setProbe] = useState<WebGpuProbeRecord | null>(null);

  const isWebGPU = backendInfo?.backendType === 'webgpu';
  const isFailed = backendInfo != null && backendInfo.backendType !== 'webgpu';

  useEffect(() => {
    if (!expanded) return undefined;
    setProbe(readProbe());
    if (isWebGPU) {
      setDiagnostics(readDeviceDiagnostics());
      const timer = window.setInterval(() => {
        setDiagnostics(readDeviceDiagnostics());
        setProbe(readProbe());
      }, 1000);
      return () => window.clearInterval(timer);
    }
    return undefined;
  }, [expanded, isWebGPU]);

  if (!backendInfo) return null;

  const chipColor = isFailed ? '#ff6666' : '#00ff00';

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
              style={{ ...switchButtonStyle(false, true), marginRight: 0 }}
              title="WebGL weather is a GLSL reference — not a live backend"
              disabled
            >
              WebGL2 (reference)
            </button>
          </div>
          <div style={{ color: '#888', fontSize: '9px', marginBottom: '8px' }}>
            WebGPU required — WebGL weather is not a live backend
          </div>

          {(probe || backendInfo.fallbackReason) && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '6px 0' }} />
              <div style={{ color: isFailed ? '#ff9999' : '#ccc', fontSize: '10px', lineHeight: 1.5 }}>
                {probe && (
                  <>
                    <div>brand: {probe.browserBrand}</div>
                    <div>stage: {probe.stage}{probe.ok ? '' : ' (failed)'}</div>
                    {probe.adapter && (
                      <div title={probe.adapter.description}>
                        adapter: {probe.adapter.vendor} / {probe.adapter.architecture}
                      </div>
                    )}
                    {probe.webglPreferenceDeferred && (
                      <div style={{ color: '#ffcc66' }}>webgl preference ignored (no live GL weather)</div>
                    )}
                  </>
                )}
                {(probe?.reason || backendInfo.fallbackReason) && (
                  <div
                    style={{
                      color: '#ff6666',
                      marginTop: 4,
                      wordBreak: 'break-word',
                    }}
                    title={probe?.reason || backendInfo.fallbackReason}
                  >
                    {probe?.reason || backendInfo.fallbackReason}
                  </div>
                )}
              </div>
            </>
          )}

          {diagnostics && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '6px 0' }} />
              <div style={{ color: '#ccc', fontSize: '10px', lineHeight: 1.5 }}>
                <div>
                  featureLevel: {diagnostics.featureLevel}
                  {diagnostics.forceFallbackAdapter ? ' (fallback adapter)' : ''}
                </div>
                <div>canvas: {diagnostics.colorSpace} / {diagnostics.toneMapping}</div>
                <div title={`${diagnostics.optionalFeaturesEnabled.length} enabled of ${diagnostics.optionalFeaturesAttempted.length} attempted`}>
                  optional features: {diagnostics.optionalFeaturesEnabled.length}/{diagnostics.optionalFeaturesAttempted.length}
                </div>
                {wantsGpuFeatureDump() && (
                  <pre
                    style={{
                      margin: '6px 0 0',
                      maxHeight: '140px',
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: '#9cf',
                      fontSize: '9px',
                    }}
                  >
                    {JSON.stringify(
                      {
                        attempted: diagnostics.optionalFeaturesAttempted,
                        enabled: diagnostics.optionalFeaturesEnabled,
                      },
                      null,
                      2,
                    )}
                  </pre>
                )}
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
        </div>
      )}
      <div
        style={{ ...chipStyle, color: chipColor, borderColor: isFailed ? '#663333' : '#333' }}
        onClick={() => setExpanded(v => !v)}
        title={backendInfo.fallbackReason || 'Click to toggle renderer backend controls'}
      >
        {chipLabel(backendInfo)}
      </div>
    </>
  );
};

export default RendererBackendIndicator;
