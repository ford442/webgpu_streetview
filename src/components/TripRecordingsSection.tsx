import React, { useMemo, useRef, useState } from 'react';
import type { TripRecordingBindings } from '../app/useTripRecording';
import { useTripLibrary } from '../trip/tripLibrary';
import { formatEta } from '../services/routing/guidanceFormat';
import { formatImageDate } from '../utils/historicalImagery';
import { TRIP_FILE_EXTENSION } from '../trip/tripFile';

const btn = (bg: string, disabled = false): React.CSSProperties => ({
  padding: '6px 10px',
  background: disabled ? 'rgba(255,255,255,0.08)' : bg,
  color: disabled ? '#888' : '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 12,
  fontWeight: 600,
});

const subtle = 'rgba(255,255,255,0.12)';

/**
 * Recorded road trips: replay (metered — the button says how many lookups),
 * scrub, export `.svtrip`, share a `?trip=` link, import, and the album of
 * stills taken on the way.
 */
export function TripRecordingsSection({
  snapshots,
  importError,
  onReplay,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onExport,
  onShareLink,
  onImport,
  onDelete,
  onShowAlbum,
}: TripRecordingBindings) {
  const recordings = useTripLibrary((s) => s.recordings);
  const recordingId = useTripLibrary((s) => s.recordingId);
  const replay = useTripLibrary((s) => s.replay);
  const albumId = useTripLibrary((s) => s.albumId);
  const album = useMemo(() => {
    const recording = recordings.find((r) => r.id === albumId);
    if (!recording) return null;
    const thumbs = new Map(snapshots.map((s) => [s.id, s.thumbnailDataUrl ?? s.dataUrl]));
    return {
      recording,
      entries: recording.stills.map((still) => ({ ...still, thumbnailDataUrl: thumbs.get(still.snapshotId) ?? null })),
    };
  }, [recordings, albumId, snapshots]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkNote, setLinkNote] = useState<{ id: string; text: string } | null>(null);

  const share = async (id: string): Promise<void> => {
    const url = await onShareLink(id);
    if (!url) {
      setLinkNote({ id, text: `Too long for a link — share the ${TRIP_FILE_EXTENSION} file instead.` });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkNote({ id, text: 'Link copied.' });
    } catch {
      window.prompt('Copy this trip link', url);
    }
  };

  const replaying = replay && (replay.status === 'playing' || replay.status === 'paused') ? replay : null;

  return (
    <section aria-label="Trip recordings" style={{ borderTop: '1px solid #333', paddingTop: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Recordings</h3>
        <button type="button" onClick={() => fileRef.current?.click()} style={btn(subtle)}>Import…</button>
        <input
          ref={fileRef}
          type="file"
          accept={`${TRIP_FILE_EXTENSION},application/json,application/gzip`}
          aria-label="Import a trip recording"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = '';
          }}
        />
      </div>
      {recordingId && <p role="status" style={{ fontSize: 12, color: '#e57373', margin: '0 0 8px' }}>● Recording this drive</p>}
      {importError && <p role="alert" style={{ color: '#ff6b6b', fontSize: 12, margin: '0 0 8px' }}>{importError}</p>}

      {replay && (
        <div aria-label="Replay" role="group" style={{ background: 'rgba(255,255,255,0.06)', padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
          <label style={{ display: 'block' }}>
            Replay hop {replay.index + 1} / {replay.total} · {replay.callsUsed} metered lookup{replay.callsUsed === 1 ? '' : 's'}
            <input
              type="range"
              min={0}
              max={Math.max(0, replay.total - 1)}
              value={replay.index}
              aria-label="Scrub the replay"
              onChange={(e) => onSeekReplay(Number(e.target.value))}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          {(replay.substituted > 0 || replay.skipped > 0 || replay.dateMismatches > 0) && (
            <p style={{ margin: '4px 0', color: '#ffcc80' }}>
              {replay.substituted > 0 && `${replay.substituted} pano${replay.substituted === 1 ? '' : 's'} gone — shown the recorded year nearby. `}
              {replay.skipped > 0 && `${replay.skipped} skipped (no longer on Street View). `}
              {replay.dateMismatches > 0 && `${replay.dateMismatches} with a different capture date than recorded.`}
            </p>
          )}
          {replay.message && <p role="alert" style={{ margin: '4px 0', color: '#ff6b6b' }}>{replay.message}</p>}
          {replay.status === 'done' && <p style={{ margin: '4px 0' }}>Replay finished.</p>}
          <div style={{ display: 'flex', gap: 6 }}>
            {replaying?.status === 'playing' && <button type="button" onClick={onPauseReplay} style={btn(subtle)}>Pause</button>}
            {replaying?.status === 'paused' && <button type="button" onClick={onResumeReplay} style={btn('#1565c0')}>Resume</button>}
            {replaying && <button type="button" onClick={onStopReplay} style={btn('#c62828')}>Stop</button>}
          </div>
        </div>
      )}

      {recordings.length === 0 ? (
        <p style={{ fontSize: 12, color: '#999', margin: 0 }}>Drive a planned route to record it.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {recordings.map((r) => {
            const dates = Array.from(new Set(r.hops.map((h) => h.panoDate).filter((d): d is string => !!d))).sort();
            return (
              <li key={r.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                <div style={{ color: '#aaa', fontSize: 11, margin: '2px 0 6px' }}>
                  {new Date(r.createdAt).toLocaleString()} · {r.hops.length} hops · {formatEta(r.durationMs / 1000)}
                  {dates.length > 0 && ` · ${formatImageDate(dates[0]!)}${dates.length > 1 ? `–${formatImageDate(dates[dates.length - 1]!)}` : ''}`}
                  {r.stills.length > 0 && ` · ${r.stills.length} still${r.stills.length === 1 ? '' : 's'}`}
                  {r.truncated && ' · truncated'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => onReplay(r.id)}
                    disabled={recordingId === r.id}
                    title="Every replayed hop is one metered Street View lookup on your session's meter."
                    style={btn('#1565c0', recordingId === r.id)}
                  >
                    Replay ({r.hops.length} lookups)
                  </button>
                  <button type="button" onClick={() => onExport(r.id)} style={btn(subtle)}>Export {TRIP_FILE_EXTENSION}</button>
                  <button type="button" onClick={() => void share(r.id)} style={btn(subtle)}>Share link</button>
                  <button
                    type="button"
                    onClick={() => onShowAlbum(album?.recording.id === r.id ? null : r.id)}
                    aria-pressed={album?.recording.id === r.id}
                    style={btn(subtle)}
                  >
                    Album
                  </button>
                  <button type="button" onClick={() => onDelete(r.id)} style={btn(subtle)} aria-label={`Delete ${r.name}`}>Delete</button>
                </div>
                {linkNote?.id === r.id && <p role="status" style={{ fontSize: 11, margin: '4px 0 0' }}>{linkNote.text}</p>}
                {album?.recording.id === r.id && (
                  <div aria-label="Trip album" style={{ marginTop: 8 }}>
                    {album.entries.length === 0 ? (
                      <p style={{ fontSize: 11, color: '#999', margin: 0 }}>No snapshots were taken on this trip. The route shows on the coverage map.</p>
                    ) : (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {album.entries.map((e) => (
                          <li key={e.snapshotId} style={{ width: 72, fontSize: 10, color: '#ccc' }}>
                            {e.thumbnailDataUrl
                              ? <img src={e.thumbnailDataUrl} alt={e.name} style={{ width: 72, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                              : <div style={{ width: 72, height: 48, background: '#222', borderRadius: 4 }} aria-label={`${e.name} (removed from the gallery)`} />}
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
