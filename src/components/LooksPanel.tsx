import React, { useMemo, useState } from 'react';
import { LOOK_IDS, LOOK_PACKS, lookPackMatchesState, type LookEnvSnapshot, type LookId } from '../config/lookPacks';
import { buildLookUrl } from '../utils/lookLink';

export interface LooksPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeLookId: LookId | null;
  state: LookEnvSnapshot;
  onApplyLook: (id: string) => void;
  reducedMotion?: boolean;
}

const LooksPanel: React.FC<LooksPanelProps> = ({
  isOpen,
  onClose,
  activeLookId,
  state,
  onApplyLook,
  reducedMotion = false,
}) => {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const customized = useMemo(() => {
    if (!activeLookId) return false;
    const pack = LOOK_PACKS[activeLookId];
    return !lookPackMatchesState(pack, state);
  }, [activeLookId, state]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    const url = buildLookUrl({ lookId: activeLookId, state });
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('Look URL copied');
    } catch {
      setCopyStatus(url);
    }
    window.setTimeout(() => setCopyStatus(null), 2500);
  };

  const labelStyle: React.CSSProperties = {
    color: '#fff',
    fontSize: '12px',
    fontFamily: 'monospace',
    display: 'block',
    marginBottom: '2px',
  };

  return (
    <div
      role="dialog"
      aria-label="Looks"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: '80px',
        right: '20px',
        width: '340px',
        maxHeight: 'calc(100vh - 120px)',
        backgroundColor: 'rgba(20, 22, 32, 0.96)',
        borderRadius: '12px',
        border: '1px solid #3d3560',
        zIndex: 100,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #3d3560',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ margin: 0, color: '#E1BEE7', fontSize: '15px', letterSpacing: '0.5px' }}>
          🎞 Looks
        </h3>
        <button
          onClick={onClose}
          aria-label="Close looks panel"
          style={{
            background: 'none',
            border: 'none',
            color: '#aaa',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '0 5px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1 }}>
        <div style={{ ...labelStyle, marginBottom: '10px', color: '#b39ddb' }}>
          Scene packs — weather + grade + time of day. ACES stays last.
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
          }}
        >
          {LOOK_IDS.map((id) => {
            const pack = LOOK_PACKS[id];
            const selected = activeLookId === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                title={pack.description}
                onClick={() => onApplyLook(id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 10px 8px',
                  border: `1px solid ${selected ? '#CE93D8' : '#3d3560'}`,
                  borderRadius: '8px',
                  backgroundColor: selected ? 'rgba(206,147,216,0.18)' : 'rgba(0,0,0,0.45)',
                  color: selected ? '#F3E5F5' : '#ccc',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  minHeight: 72,
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: 4 }}>
                  {pack.emoji} {pack.name}
                </div>
                <div style={{ fontSize: '10px', color: '#aaa', lineHeight: 1.35 }}>
                  {pack.tagline}
                </div>
              </button>
            );
          })}
        </div>

        {activeLookId && (
          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              backgroundColor: 'rgba(0,0,0,0.35)',
              borderRadius: 8,
              border: '1px solid #3d3560',
            }}
          >
            <div style={{ color: '#E1BEE7', fontSize: 12, fontFamily: 'monospace', marginBottom: 6 }}>
              {LOOK_PACKS[activeLookId].name}
              {customized ? ' · customized' : ''}
            </div>
            <div style={{ color: '#bbb', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.45 }}>
              <strong style={{ color: '#888' }}>Before: </strong>
              {LOOK_PACKS[activeLookId].before}
            </div>
            <div style={{ color: '#bbb', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.45, marginTop: 6 }}>
              <strong style={{ color: '#888' }}>After: </strong>
              {LOOK_PACKS[activeLookId].after}
            </div>
          </div>
        )}

        {reducedMotion && (
          <div style={{ marginTop: 10, fontSize: 10, color: '#80CBC4', fontFamily: 'monospace' }}>
            Reduced motion: cinematic DOF / motion blur stay off. Looks still apply.
          </div>
        )}
      </div>

      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #3d3560',
          backgroundColor: 'rgba(0,0,0,0.25)',
        }}
      >
        <button
          type="button"
          onClick={() => { void handleCopy(); }}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #CE93D8',
            borderRadius: 6,
            backgroundColor: 'rgba(206,147,216,0.12)',
            color: '#E1BEE7',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: 700,
          }}
        >
          Copy look as URL
        </button>
        {copyStatus && (
          <div
            role="status"
            style={{
              marginTop: 8,
              fontSize: 10,
              color: '#ce93d8',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            }}
          >
            {copyStatus}
          </div>
        )}
      </div>
    </div>
  );
};

export default LooksPanel;
