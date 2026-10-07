import React from 'react';
import { describeConditions } from '../services/conditions/openMeteo';
import { liveConditionsStore, useLiveConditions } from '../state/liveConditionsStore';

const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #2a4a6a',
  background: active ? 'rgba(79,195,247,0.25)' : 'rgba(255,255,255,0.06)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12,
});

/**
 * "Live conditions" toggle for the weather panel: the real weather at the
 * pano (Open-Meteo, opt-in). Moving any weather slider takes over until
 * "Resume live" — manual control always wins.
 */
const LiveConditionsControl: React.FC = () => {
  const enabled = useLiveConditions((s) => s.enabled);
  const status = useLiveConditions((s) => s.status);
  const conditions = useLiveConditions((s) => s.conditions);
  const error = useLiveConditions((s) => s.error);

  let line = '';
  if (enabled) {
    if (status === 'loading') line = 'Fetching the weather here…';
    else if (status === 'error') line = `Live weather unavailable (${error ?? 'error'}) — controls stay manual.`;
    else if (conditions) {
      line = `${describeConditions(conditions)}${status === 'overridden' ? ' · manual override' : ''}`;
    }
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-pressed={enabled}
          onClick={() => liveConditionsStore.setEnabled(!enabled)}
          style={pill(enabled)}
        >
          📡 Live conditions
        </button>
        {enabled && status === 'overridden' && (
          <button type="button" onClick={() => liveConditionsStore.resume()} style={pill(false)}>
            Resume live
          </button>
        )}
      </div>
      {line && (
        <div role="status" style={{ color: status === 'error' ? '#ffb74d' : '#9ec9e2', fontSize: 12, marginTop: 6 }}>
          {line}
        </div>
      )}
      {enabled && (
        <div style={{ color: '#777', fontSize: 11, marginTop: 4 }}>
          Weather data by{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" style={{ color: '#9ec9e2' }}>
            Open-Meteo.com
          </a>{' '}
          (CC BY 4.0)
        </div>
      )}
    </div>
  );
};

export default LiveConditionsControl;
