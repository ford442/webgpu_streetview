import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ViewModeProvider, useViewMode } from '../useViewMode';

vi.mock('../../car/carRuntimeLoader', () => ({
  loadCarRuntime: vi.fn().mockResolvedValue({
    initCarMode: vi.fn(),
    toggleCarMode: vi.fn(),
    disposeCarMode: vi.fn(),
  }),
}));

function Probe() {
  const { controlMode, isTempSteerMode, startTempSteerMode, setControlMode } = useViewMode();
  return (
    <div>
      <span data-testid="mode">{controlMode}</span>
      <span data-testid="temp">{String(isTempSteerMode)}</span>
      <button type="button" onClick={() => startTempSteerMode()}>wheel</button>
      <button type="button" onClick={() => setControlMode('freeLook')}>free</button>
    </div>
  );
}

describe('useViewMode temp-steer cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears isTempSteerMode when setControlMode is called manually', () => {
    render(
      <ViewModeProvider initialMode="car">
        <Probe />
      </ViewModeProvider>,
    );

    act(() => {
      screen.getByText('wheel').click();
    });
    expect(screen.getByTestId('mode').textContent).toBe('carSteer');
    expect(screen.getByTestId('temp').textContent).toBe('true');

    act(() => {
      screen.getByText('free').click();
    });
    expect(screen.getByTestId('mode').textContent).toBe('freeLook');
    expect(screen.getByTestId('temp').textContent).toBe('false');
  });
});
