import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DashboardUI, DashboardUIProps } from '../DashboardUI';

vi.mock('../Gauges', () => ({
  TelemetryChip: ({ speedKmh }: { speedKmh: number }) => (
    <div data-testid="telemetry-chip">{Math.round(speedKmh)} km/h</div>
  ),
}));

vi.mock('../Controls', () => ({
  AudioVisualizer: () => <div data-testid="audio-visualizer" />,
  GPS_ICON: 'M0 0',
  RADIO_ICON: 'M0 0',
  ROOF_ICON: 'M0 0',
  WIPER_ICON: 'M0 0',
  HEADLIGHT_ICON: 'M0 0',
  HIGHBEAM_ICON: 'M0 0',
  DOME_ICON: 'M0 0',
  VEHICLE_ICON: 'M0 0',
}));

const baseProps: DashboardUIProps = {
  isVisible: true,
  hudMode: 'compact',
  isRadioPlaying: false,
  onToggleGPS: vi.fn(),
  onToggleRadio: vi.fn(),
  onRainIntensity: vi.fn(),
  onTimeOfDay: vi.fn(),
  onToggleRoof: vi.fn(),
  isRoofOpen: false,
  rainIntensity: 0,
  timeOfDay: 'day',
  speedKmh: 32,
  rpm: 1200,
  gear: 'D',
  onToggleHeadlights: vi.fn(),
  onToggleWipers: vi.fn(),
};

describe('DashboardUI HUD modes', () => {
  it('renders compact corner chip by default mode', () => {
    render(<DashboardUI {...baseProps} hudMode="compact" />);

    expect(screen.getByTestId('telemetry-chip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle GPS' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Select Time of Day')).not.toBeInTheDocument();
  });

  it('renders immersive telemetry chip without a floating DOM speedo or cluster', () => {
    render(<DashboardUI {...baseProps} hudMode="immersive" speedKmh={47.7} />);

    expect(screen.getByTestId('telemetry-chip')).toHaveTextContent('48 km/h');
    expect(screen.queryByRole('button', { name: 'Toggle GPS' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select Time of Day')).not.toBeInTheDocument();
  });
});
