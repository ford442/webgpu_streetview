import React, { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CarInputHandler from '../CarInputHandler';

const setCarHeading = vi.fn();
const setHeading = vi.fn();
const setPitch = vi.fn();
const startTempSteerMode = vi.fn();
const endTempSteerMode = vi.fn();

let controlMode: 'freeLook' | 'uiMouse' | 'carSteer' = 'freeLook';
let headCoupling: 'free' | 'rigid' = 'free';
let isTempSteerMode = false;

vi.mock('../../hooks/useStreetView', () => ({
  useStreetView: () => ({
    heading: 10,
    pitch: 5,
    setHeading,
    setPitch,
    setZoom: vi.fn(),
    advance: vi.fn(),
  }),
}));

vi.mock('../../hooks/useViewMode', () => ({
  useViewMode: () => ({
    toggleViewMode: vi.fn(),
    controlMode,
    toggleControlMode: vi.fn(),
    headCoupling,
    startTempSteerMode,
    endTempSteerMode,
    isTempSteerMode,
    carHeading: 34,
    setCarHeading,
  }),
}));

const Harness: React.FC<{
  isSteeringWheelAtPoint?: (x: number, y: number) => boolean;
}> = ({ isSteeringWheelAtPoint }) => {
  const targetRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={targetRef} data-testid="target">
      <CarInputHandler
        targetRef={targetRef}
        isSteeringWheelAtPoint={isSteeringWheelAtPoint}
      />
    </div>
  );
};

function mouseDown(target: Element, button: number, clientX = 100, clientY = 100) {
  target.dispatchEvent(
    new MouseEvent('mousedown', { button, clientX, clientY, bubbles: true })
  );
}

function mouseMove(movementX: number, movementY: number, buttons: number, shiftKey = false) {
  window.dispatchEvent(
    new MouseEvent('mousemove', {
      movementX,
      movementY,
      buttons,
      shiftKey,
      bubbles: true,
    })
  );
}

describe('CarInputHandler free-look chassis coupling', () => {
  beforeEach(() => {
    setCarHeading.mockClear();
    setHeading.mockClear();
    setPitch.mockClear();
    startTempSteerMode.mockClear();
    endTempSteerMode.mockClear();
    controlMode = 'freeLook';
    headCoupling = 'free';
    isTempSteerMode = false;
  });

  it('left-drag in freeLook pans head without rotating chassis', () => {
    render(<Harness isSteeringWheelAtPoint={() => false} />);
    const target = screen.getByTestId('target');

    mouseDown(target, 0);
    mouseMove(12, -4, 1);

    expect(setHeading).toHaveBeenCalled();
    expect(setCarHeading).not.toHaveBeenCalled();
  });

  it('RMB drag in freeLook does not steer chassis', () => {
    render(<Harness isSteeringWheelAtPoint={() => false} />);
    const target = screen.getByTestId('target');

    mouseDown(target, 2);
    mouseMove(15, 0, 2);

    expect(setCarHeading).not.toHaveBeenCalled();
  });

  it('Shift+left-drag in freeLook does not steer chassis', () => {
    render(<Harness isSteeringWheelAtPoint={() => false} />);
    const target = screen.getByTestId('target');

    mouseDown(target, 0);
    mouseMove(20, 0, 1, true);

    expect(setCarHeading).not.toHaveBeenCalled();
    expect(setHeading).toHaveBeenCalled();
  });

  it('steering-wheel grab in freeLook may steer (temp-steer handoff)', () => {
    render(<Harness isSteeringWheelAtPoint={() => true} />);
    const target = screen.getByTestId('target');

    mouseDown(target, 0);
    expect(startTempSteerMode).toHaveBeenCalled();
    mouseMove(8, 0, 1);

    expect(setCarHeading).toHaveBeenCalled();
  });
});
