// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tripStore } from '../state/tripStore';
import TripPlannerPanel from './TripPlannerPanel';

function props(overrides: Partial<React.ComponentProps<typeof TripPlannerPanel>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    routing: { endpoint: 'https://osrm.example', usingDemo: false },
    getOrigin: () => ({ lat: 55.95, lng: -3.2 }),
    onPlan: vi.fn(),
    onDrive: vi.fn(),
    onStop: vi.fn(),
    onClear: vi.fn(),
    onSaveOffline: vi.fn(),
    offlineBusy: false,
    offlineError: null,
    isCruiseMode: false,
    getShareUrl: () => null,
    ...overrides,
  };
}

afterEach(() => tripStore.reset());

describe('TripPlannerPanel', () => {
  it('plans from the current location to a typed lat, lng destination', () => {
    const p = props();
    render(<TripPlannerPanel {...p} />);
    const plan = screen.getByRole('button', { name: 'Plan route' });
    expect(plan).toBeDisabled();
    const input = screen.getByLabelText(/Destination/);
    fireEvent.change(input, { target: { value: '55.948, -3.195' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(plan).toBeEnabled();
    fireEvent.click(plan);
    expect(p.onPlan).toHaveBeenCalledWith([
      { lat: 55.95, lng: -3.2, label: 'Current location' },
      { lat: 55.948, lng: -3.195, label: '55.948, -3.195' },
    ]);
  });

  it('keeps keyboard and pointer input away from the street view', () => {
    const windowKey = vi.fn();
    const windowMouse = vi.fn();
    window.addEventListener('keydown', windowKey);
    window.addEventListener('mousedown', windowMouse);
    render(<TripPlannerPanel {...props()} />);
    const input = screen.getByLabelText(/Destination/);
    fireEvent.keyDown(input, { key: 'w' });
    fireEvent.mouseDown(input);
    expect(windowKey).not.toHaveBeenCalled();
    expect(windowMouse).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowKey);
    window.removeEventListener('mousedown', windowMouse);
  });

  it('shows an honest error and never a route when planning failed', () => {
    tripStore.reset({ status: 'error', error: 'The routing server could not be reached.' });
    render(<TripPlannerPanel {...props()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be reached');
    expect(screen.queryByRole('button', { name: 'Drive' })).toBeNull();
  });

  it('says so when routing is switched off', () => {
    render(<TripPlannerPanel {...props({ routing: { endpoint: null, usingDemo: false } })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/switched off/);
  });

  it('closes on Escape', () => {
    const p = props();
    render(<TripPlannerPanel {...p} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalled();
  });
});
