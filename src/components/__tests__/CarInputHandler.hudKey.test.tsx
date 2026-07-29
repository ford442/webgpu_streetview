import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CarInputHandler from '../CarInputHandler';

vi.mock('../../hooks/useStreetView', () => ({
  useStreetView: () => ({
    heading: 0,
    pitch: 0,
    setHeading: vi.fn(),
    setPitch: vi.fn(),
    setZoom: vi.fn(),
    advance: vi.fn(),
  }),
}));

vi.mock('../../hooks/useViewMode', () => ({
  useViewMode: () => ({
    toggleViewMode: vi.fn(),
    controlMode: 'freeLook',
    toggleControlMode: vi.fn(),
    headCoupling: 'free',
    startTempSteerMode: vi.fn(),
    endTempSteerMode: vi.fn(),
    isTempSteerMode: false,
    carHeading: 0,
    setCarHeading: vi.fn(),
  }),
}));

const Harness: React.FC<{
  onHudKeyDown: () => void;
  onHudKeyUp: () => void;
}> = ({ onHudKeyDown, onHudKeyUp }) => {
  const targetRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={targetRef}>
      <CarInputHandler targetRef={targetRef} onHudKeyDown={onHudKeyDown} onHudKeyUp={onHudKeyUp} />
    </div>
  );
};

describe('CarInputHandler HUD key wiring', () => {
  it('sends U key down/up events and ignores repeated keydown', () => {
    const onHudKeyDown = vi.fn();
    const onHudKeyUp = vi.fn();

    render(<Harness onHudKeyDown={onHudKeyDown} onHudKeyUp={onHudKeyUp} />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'u' }));

    expect(onHudKeyDown).toHaveBeenCalledTimes(1);
    expect(onHudKeyUp).toHaveBeenCalledTimes(1);
  });
});
