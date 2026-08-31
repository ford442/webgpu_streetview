import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteGeocodeStatus, resetGeocodeAuthForTests } from '../../search/geocodeAuth';
import { GeocodeDeniedToast } from './GeocodeDeniedToast';

describe('GeocodeDeniedToast', () => {
  afterEach(() => {
    cleanup();
    act(() => {
      resetGeocodeAuthForTests();
    });
    vi.restoreAllMocks();
  });

  it('is hidden until REQUEST_DENIED, then shows ops copy without a key', () => {
    render(<GeocodeDeniedToast />);
    expect(screen.queryByRole('status')).toBeNull();

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    act(() => {
      noteGeocodeStatus('REQUEST_DENIED');
    });

    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent(/Geocoding REQUEST_DENIED/i);
    expect(toast).toHaveTextContent(/HTTP-referrer browser key/i);
    expect(toast).toHaveTextContent(/test.1ink.us/);
    expect(toast).toHaveTextContent(/go.1ink.us/);
    expect(toast.textContent).not.toMatch(/AIza/);
    expect(toast.textContent).not.toMatch(/cruise/i);
  });
});
