import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StreetViewRenderer } from '../renderer/RendererBackend';
import {
  CanvasClipRecorder,
  downloadClip,
  isClipRecordingSupported,
  type ClipRecorderState,
} from '../utils/canvasRecorder';

export interface CinemaOverlayProps {
  visible: boolean;
  letterbox: boolean;
  onToggleLetterbox: () => void;
  gradingLocked: boolean;
  onToggleGradingLock: () => void;
  renderer: StreetViewRenderer | null;
  onExit: () => void;
  onTakeSnapshot?: () => void;
}

const MIN_CLIP_MS = 15_000;

const CinemaOverlay: React.FC<CinemaOverlayProps> = ({
  visible,
  letterbox,
  onToggleLetterbox,
  gradingLocked,
  onToggleGradingLock,
  renderer,
  onExit,
  onTakeSnapshot,
}) => {
  const [recState, setRecState] = useState<ClipRecorderState>(
    isClipRecordingSupported() ? 'idle' : 'unsupported',
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  const recorderRef = useRef<CanvasClipRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupRecorder = useCallback(() => {
    stopTimer();
    recorderRef.current?.dispose();
    recorderRef.current = null;
    setElapsedSec(0);
    setRecState(isClipRecordingSupported() ? 'idle' : 'unsupported');
  }, [stopTimer]);

  useEffect(() => {
    if (!visible) cleanupRecorder();
    return cleanupRecorder;
  }, [visible, cleanupRecorder]);

  const handleStartRecording = useCallback(() => {
    if (!renderer?.canvas || recState === 'recording') return;
    cleanupRecorder();
    const recorder = new CanvasClipRecorder(renderer.canvas, { fps: 30, burnAttribution: true });
    if (recorder.getState() === 'unsupported') {
      setRecState('unsupported');
      return;
    }
    recorderRef.current = recorder;
    recorder.start();
    setRecState('recording');
    setElapsedSec(0);
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
  }, [renderer, recState, cleanupRecorder]);

  const handleStopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recState !== 'recording') return;
    stopTimer();
    try {
      const result = await recorder.stop();
      downloadClip(result.blob, result.mimeType);
      setRecState('stopped');
    } catch (err) {
      console.error('[CinemaOverlay] clip stop failed', err);
      setRecState('idle');
    } finally {
      recorder.dispose();
      recorderRef.current = null;
      setElapsedSec(0);
      setTimeout(() => setRecState(isClipRecordingSupported() ? 'idle' : 'unsupported'), 1500);
    }
  }, [recState, stopTimer]);

  if (!visible) return null;

  const canStop = recState === 'recording' && elapsedSec * 1000 >= MIN_CLIP_MS;
  const recordingHint =
    recState === 'recording' && !canStop
      ? `Record ≥${MIN_CLIP_MS / 1000}s (${elapsedSec}s)`
      : null;

  return (
    <>
      {letterbox && (
        <>
          <div
            aria-hidden
            data-testid="cinema-letterbox-top"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              height: '10vh',
              background: '#000',
              zIndex: 50,
              pointerEvents: 'none',
            }}
          />
          <div
            aria-hidden
            data-testid="cinema-letterbox-bottom"
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              height: '10vh',
              background: '#000',
              zIndex: 50,
              pointerEvents: 'none',
            }}
          />
        </>
      )}

      <div
        role="toolbar"
        aria-label="Cinema mode controls"
        data-testid="cinema-overlay"
        style={{
          position: 'fixed',
          bottom: letterbox ? '12vh' : 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 60,
          display: 'flex',
          gap: 8,
          padding: '10px 14px',
          background: 'rgba(0,0,0,0.72)',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.15)',
          pointerEvents: 'auto',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {recState === 'unsupported' ? (
          <span style={{ color: '#f0ad4e', fontSize: 12 }}>WebM recording unavailable</span>
        ) : recState === 'recording' ? (
          <button
            type="button"
            data-testid="cinema-stop-recording"
            disabled={!canStop}
            onClick={() => void handleStopRecording()}
            style={btnStyle('#d9534f', !canStop)}
            title={recordingHint ?? 'Stop and download clip'}
          >
            ■ Stop {elapsedSec > 0 ? `(${elapsedSec}s)` : ''}
          </button>
        ) : (
          <button
            type="button"
            data-testid="cinema-start-recording"
            onClick={handleStartRecording}
            disabled={!renderer}
            style={btnStyle('#d9534f')}
            title="Record WebM clip (min 15s)"
          >
            ● Record
          </button>
        )}

        {onTakeSnapshot && (
          <button type="button" onClick={onTakeSnapshot} style={btnStyle('#2196F3')} title="Capture still">
            📷 Still
          </button>
        )}

        <button
          type="button"
          data-testid="cinema-letterbox-toggle"
          onClick={onToggleLetterbox}
          style={btnStyle(letterbox ? '#4CAF50' : '#555')}
          title="Toggle letterbox"
        >
          ▬ Letterbox
        </button>

        <button
          type="button"
          data-testid="cinema-grading-lock"
          onClick={onToggleGradingLock}
          style={btnStyle(gradingLocked ? '#4CAF50' : '#555')}
          title="Lock exposure/grading"
        >
          {gradingLocked ? '🔒 Locked' : '🔓 Grade'}
        </button>

        <button
          type="button"
          data-testid="cinema-exit"
          onClick={onExit}
          style={btnStyle('#555')}
          title="Exit cinema mode (Esc)"
        >
          Esc Exit
        </button>
      </div>

      {recordingHint && (
        <div
          style={{
            position: 'fixed',
            top: letterbox ? '12vh' : 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            color: '#fff',
            background: 'rgba(213,83,79,0.85)',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 13,
            pointerEvents: 'none',
          }}
        >
          {recordingHint}
        </div>
      )}
    </>
  );
};

function btnStyle(bg: string, disabled = false): React.CSSProperties {
  return {
    padding: '8px 12px',
    border: 'none',
    borderRadius: 6,
    background: disabled ? '#444' : bg,
    color: disabled ? '#888' : '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

export default CinemaOverlay;
