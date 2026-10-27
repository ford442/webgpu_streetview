import React, { useCallback, useEffect, useState } from 'react';
import { getLastXrSupport, type XrSupport } from '../../xr/xrSupport';
import { getActiveXrCockpit, startXrCockpit, type XrCockpitDeps } from '../../xr/xrSession';

/**
 * The "Enter VR" dashboard button (#331). Hidden when the browser has no
 * WebXR at all (or `?xr=off`); otherwise it either enters the headset or says
 * honestly why it cannot — never a button that silently does nothing.
 */
export interface XrButtonView {
  hidden: boolean;
  disabled: boolean;
  label: string;
  /** Why it is disabled, or what it does — the tooltip and the line under it. */
  reason: string;
}

export function xrButtonView(
  support: XrSupport | null,
  hasDevice: boolean,
  active: boolean,
  error: string | null,
): XrButtonView {
  if (active) return { hidden: false, disabled: false, label: 'Exit VR', reason: 'Leave the headset and return to the screen.' };
  if (!support || support.state === 'off' || support.state === 'no-webxr') {
    return { hidden: true, disabled: true, label: 'Enter VR', reason: support?.reason ?? '' };
  }
  if (support.state !== 'available') return { hidden: false, disabled: true, label: 'Enter VR', reason: support.reason };
  if (!hasDevice) {
    return { hidden: false, disabled: true, label: 'Enter VR', reason: 'Needs the WebGPU renderer (this page fell back to WebGL).' };
  }
  return { hidden: false, disabled: false, label: 'Enter VR', reason: error ?? 'Sit in the cockpit with a headset. Left stick steers, right trigger presses dash controls.' };
}

export interface XrCockpitButtonProps {
  device: GPUDevice | undefined;
  pressAlongRay: XrCockpitDeps['pressAlongRay'];
}

export const XrCockpitButton: React.FC<XrCockpitButtonProps> = ({ device, pressAlongRay }) => {
  const [active, setActive] = useState(() => getActiveXrCockpit() !== null);
  const [error, setError] = useState<string | null>(null);
  const view = xrButtonView(getLastXrSupport(), !!device, active, error);

  // The HUD can hide and come back mid-session: follow the running one's end.
  useEffect(() => {
    let mounted = true;
    void getActiveXrCockpit()?.ended.then(() => {
      if (mounted) setActive(false);
    });
    return () => {
      mounted = false;
    };
  }, [active]);

  const onClick = useCallback(() => {
    const running = getActiveXrCockpit();
    if (running) {
      void running.end();
      return;
    }
    if (!device) return;
    setError(null);
    // Called synchronously from the click: requestSession needs the gesture.
    startXrCockpit({ device, pressAlongRay }).then(
      (cockpit) => {
        setActive(true);
        void cockpit.ended.then((reason) => {
          setActive(false);
          if (reason === 'device-lost') setError('The GPU device was lost; the session ended and the screen view recovered.');
        });
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, [device, pressAlongRay]);

  if (view.hidden) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      onMouseDown={stop}
      onMouseUp={stop}
      onMouseMove={stop}
      onClick={stop}
      onKeyDown={stop}
      style={{ marginTop: '4px' }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={view.disabled}
        title={view.reason}
        aria-describedby={view.disabled || error ? 'xr-cockpit-reason' : undefined}
        style={{
          width: '100%',
          padding: '4px 8px',
          background: active ? 'rgba(171,71,188,0.3)' : 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '6px',
          color: view.disabled ? 'rgba(255,255,255,0.35)' : active ? '#E1BEE7' : 'rgba(255,255,255,0.75)',
          cursor: view.disabled ? 'not-allowed' : 'pointer',
          fontSize: '10px',
        }}
      >
        {view.label}
      </button>
      {(view.disabled || error) && (
        <div id="xr-cockpit-reason" role="note" style={{ fontSize: '9px', opacity: 0.6, marginTop: '3px', lineHeight: 1.3, maxWidth: '180px' }}>
          {view.reason}
        </div>
      )}
    </div>
  );
};
