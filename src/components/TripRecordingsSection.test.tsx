// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { tripLibrary } from '../trip/tripLibrary';
import type { SnapshotMetadata } from '../hooks/useSnapshots';
import type { TripRecording } from '../trip/tripRecording';
import { TripRecordingsSection } from './TripRecordingsSection';

const rec: TripRecording = {
  version: 1,
  id: 'trip-1',
  name: 'Lisbon → Porto',
  createdAt: '2026-10-21T10:00:00.000Z',
  routeId: 'route:x',
  stops: [{ lat: 38.7, lng: -9.1, label: 'Lisbon' }, { lat: 41.1, lng: -8.6, label: 'Porto' }],
  hops: [0, 1, 2].map((i) => ({
    t: i * 3000, panoId: `p${i}`, panoDate: i === 0 ? '2019-05' : '2023-08', lat: 38.7, lng: -9.1, heading: 0, pitch: 0,
    zoom: 1, carHeading: 0, weather: { rain: 0, snow: 0, wind: 0, fog: 0, timeOfDay: 'day' as const }, look: null, nightIntensity: 0,
  })),
  stills: [{ t: 3000, snapshotId: 'snap-1', name: 'Bridge', lat: 38.7, lng: -9.1, panoId: 'p1' }],
  durationMs: 6000,
  truncated: false,
};

function bindings(overrides = {}) {
  return {
    snapshots: [],
    importError: null,
    onReplay: vi.fn(),
    onPauseReplay: vi.fn(),
    onResumeReplay: vi.fn(),
    onStopReplay: vi.fn(),
    onSeekReplay: vi.fn(),
    onExport: vi.fn(),
    onShareLink: vi.fn(async () => null),
    onImport: vi.fn(),
    onDelete: vi.fn(),
    onShowAlbum: vi.fn((id: string | null) => tripLibrary.update({ albumId: id })),
    ...overrides,
  };
}

beforeEach(() => tripLibrary.resetForTests());

describe('TripRecordingsSection', () => {
  it('lists recordings with the replay cost and the imagery years', () => {
    tripLibrary.upsert(rec);
    const b = bindings();
    render(<TripRecordingsSection {...b} />);
    expect(screen.getByText(/3 hops/)).toHaveTextContent('May 2019–Aug 2023');
    fireEvent.click(screen.getByRole('button', { name: 'Replay (3 lookups)' }));
    expect(b.onReplay).toHaveBeenCalledWith('trip-1');
  });

  it('says to share a file when the trip is too long for a link', async () => {
    tripLibrary.upsert(rec);
    render(<TripRecordingsSection {...bindings()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    });
    expect(screen.getByText(/Too long for a link — share the \.svtrip file/)).toBeInTheDocument();
  });

  it('shows the replay progress, its meter use, and scrubs', () => {
    tripLibrary.upsert(rec);
    tripLibrary.update({
      replay: {
        recordingId: 'trip-1', status: 'paused', index: 1, total: 3, callsUsed: 2,
        substituted: 1, skipped: 0, dateMismatches: 0, shownPanoIds: [], message: null,
      },
    });
    const b = bindings();
    render(<TripRecordingsSection {...b} />);
    expect(screen.getByRole('group', { name: 'Replay' })).toHaveTextContent('Replay hop 2 / 3 · 2 metered lookups');
    expect(screen.getByText(/1 pano gone — shown the recorded year nearby/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Scrub the replay'), { target: { value: '2' } });
    expect(b.onSeekReplay).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(b.onResumeReplay).toHaveBeenCalled();
  });

  it('opens the album with gallery thumbnails', () => {
    tripLibrary.upsert(rec);
    render(<TripRecordingsSection {...bindings({ snapshots: [{ id: 'snap-1', thumbnailDataUrl: 'data:image/png;base64,AA==' } as SnapshotMetadata] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Album' }));
    expect(screen.getByRole('img', { name: 'Bridge' })).toHaveAttribute('src', 'data:image/png;base64,AA==');
  });
});
