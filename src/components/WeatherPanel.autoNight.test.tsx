// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WeatherPanel from './WeatherPanel';

const base = {
  rainIntensity: 0, snowIntensity: 0, wind: 0, fogDensity: 0, wipersEnabled: false,
  timeOfDay: 'day' as const,
  onRainIntensity: vi.fn(), onSnowIntensity: vi.fn(), onWind: vi.fn(), onFogDensity: vi.fn(),
  onToggleWipers: vi.fn(), onTimeOfDay: vi.fn(), onClose: vi.fn(), isOpen: true,
};

describe('WeatherPanel auto-night button', () => {
  it('renders the Auto button and toggles when a handler is provided', () => {
    const onToggle = vi.fn();
    render(<WeatherPanel {...base} autoNightMode onToggleAutoNight={onToggle} />);
    fireEvent.click(screen.getByText(/Auto/));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('omits the Auto button without a handler', () => {
    render(<WeatherPanel {...base} />);
    expect(screen.queryByText(/Auto/)).toBeNull();
  });
});
