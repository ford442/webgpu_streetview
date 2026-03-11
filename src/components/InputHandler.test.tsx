import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import InputHandler from './InputHandler';

function dispatchMouseMove(movementX: number, movementY: number, clientX: number, clientY: number) {
  const event = new MouseEvent('mousemove', { bubbles: true, clientX, clientY });
  Object.defineProperty(event, 'movementX', { value: movementX });
  Object.defineProperty(event, 'movementY', { value: movementY });
  window.dispatchEvent(event);
}

function renderInputHandler(overrides: Partial<React.ComponentProps<typeof InputHandler>> = {}) {
  const onPan = jest.fn();
  const onZoom = jest.fn();
  const onMove = jest.fn();
  const onRightClickMove = jest.fn();
  const onMouseSteer = jest.fn();

  function TestHarness() {
    const targetRef = React.useRef<HTMLDivElement>(null);

    return (
      <div ref={targetRef} data-testid="input-target">
        <InputHandler
          isEnabled
          targetRef={targetRef}
          onPan={onPan}
          onZoom={onZoom}
          onMove={onMove}
          onRightClickMove={onRightClickMove}
          onMouseSteer={onMouseSteer}
          {...overrides}
        />
      </div>
    );
  }

  render(<TestHarness />);

  return {
    target: screen.getByTestId('input-target'),
    onPan,
    onZoom,
    onMove,
    onRightClickMove,
    onMouseSteer,
  };
}

describe('InputHandler car-mode mouse drag behavior', () => {
  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses drag for head look instead of steering when Shift is held in car mode', () => {
    const { target, onPan, onMouseSteer } = renderInputHandler({
      isCarMode: true,
      isSteeringWheelAtPoint: () => false,
    });

    fireEvent.mouseDown(target, { button: 0, shiftKey: true, clientX: 40, clientY: 40 });
    dispatchMouseMove(12, -6, 52, 34);

    expect(onPan).toHaveBeenCalledWith(12, -6);
    expect(onMouseSteer).not.toHaveBeenCalled();
  });

  it('keeps steering-wheel drags in head-look mode so the car body does not rotate', () => {
    const { target, onPan, onMouseSteer } = renderInputHandler({
      isCarMode: true,
      isSteeringWheelAtPoint: () => true,
    });

    fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
    dispatchMouseMove(-9, 5, 91, 105);

    expect(onPan).toHaveBeenCalledWith(-9, 5);
    expect(onMouseSteer).not.toHaveBeenCalled();
  });
});
