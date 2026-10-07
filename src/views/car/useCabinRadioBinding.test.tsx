// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  station: vi.fn(),
  crossfadeTo: vi.fn(async () => {}),
}));

vi.mock('../../car', () => ({ setCarMediaInfo: vi.fn() }));
vi.mock('../../services/radioBrowserService', () => ({ getTopStationForLocation: h.station }));
vi.mock('../../audio/AudioAnalyzer', () => ({
  AudioAnalyzer: class {
    init = async () => true;
    start = async () => {};
    stop = () => {};
    dispose = () => {};
    setStationInfo = () => {};
    crossfadeTo = h.crossfadeTo;
    getAudioElement = () => ({}) as HTMLAudioElement;
    getAnalyser = () => null;
  },
}));

import { useCabinRadioBinding } from './useCabinRadioBinding';

const latLng = (lat: number, lng: number) => ({ lat: () => lat, lng: () => lng }) as google.maps.LatLng;
const EDINBURGH = latLng(55.9533, -3.1883);
const LEITH = latLng(55.9756, -3.1665);
const GLENCOE = latLng(56.6826, -5.1023);
const station = (id: string, state: string) => ({
  id, name: `Station ${id}`, url: `https://radio.example/${id}`, urlResolved: `https://radio.example/${id}`,
  country: 'United Kingdom', state, language: '', tags: '', codec: '', bitrate: 0, votes: 0, favicon: '',
});

beforeEach(() => {
  h.station.mockReset();
  h.crossfadeTo.mockClear();
});
afterEach(() => vi.clearAllMocks());

function setup() {
  const panorama = { getPosition: () => EDINBURGH } as unknown as google.maps.StreetViewPanorama;
  return renderHook(({ position }) => useCabinRadioBinding({ panorama, position }), {
    initialProps: { position: EDINBURGH },
  });
}

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('useCabinRadioBinding on a trip', () => {
  it('fades to a local station after crossing into another region', async () => {
    h.station.mockResolvedValueOnce(station('edi', 'Edinburgh')).mockResolvedValueOnce(station('hig', 'Highland'));
    const view = setup();
    await act(async () => { await view.result.current.handleToggleRadio(); });
    view.rerender({ position: LEITH });
    await flush();
    expect(h.station).toHaveBeenCalledTimes(1); // < 50 km: no lookup
    view.rerender({ position: GLENCOE });
    await flush();
    expect(h.crossfadeTo).toHaveBeenCalledWith('https://radio.example/hig');
    expect(view.result.current.stationName).toBe('Station hig');
  });

  it('never retunes a station the driver pinned', async () => {
    h.station.mockResolvedValueOnce(station('edi', 'Edinburgh')).mockResolvedValue(station('hig', 'Highland'));
    const view = setup();
    await act(async () => { await view.result.current.handleToggleRadio(); });
    act(() => view.result.current.togglePinStation());
    view.rerender({ position: GLENCOE });
    await flush();
    expect(h.station).toHaveBeenCalledTimes(1);
    expect(h.crossfadeTo).not.toHaveBeenCalled();
    expect(view.result.current.stationName).toBe('Station edi');
  });

  it('keeps the station when the best local one is in the same region', async () => {
    h.station.mockResolvedValueOnce(station('edi', 'Edinburgh')).mockResolvedValueOnce(station('edi2', 'Edinburgh'));
    const view = setup();
    await act(async () => { await view.result.current.handleToggleRadio(); });
    view.rerender({ position: GLENCOE });
    await flush();
    expect(h.station).toHaveBeenCalledTimes(2);
    expect(h.crossfadeTo).not.toHaveBeenCalled();
  });
});
