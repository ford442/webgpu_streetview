// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarInputHandler from '../CarInputHandler';
import { ViewModeProvider, useViewMode } from '../../hooks/useViewMode';
import { povStore } from '../../state/povStore';
import { cabinHeadStore } from '../../state/cabinHeadStore';

vi.mock('../../hooks/useStreetView', () => ({
  useStreetView: () => ({ setZoom: povStore.setZoom, advance: vi.fn() }),
}));

vi.mock('../../car/carRuntimeLoader', () => ({
  loadCarRuntime: () => new Promise(() => { /* never: no cabin in this test */ }),
}));

const ModeProbe: React.FC = () => {
  const { controlMode } = useViewMode();
  return <span data-testid="mode">{controlMode}</span>;
};

const Harness: React.FC<{ onInteriorPointerDown?: (x: number, y: number, edit: boolean) => boolean }> = ({
  onInteriorPointerDown,
}) => {
  const targetRef = useRef<HTMLDivElement>(null);
  return (
    <ViewModeProvider>
      <ModeProbe />
      <div ref={targetRef} data-testid="cabin">
        <CarInputHandler targetRef={targetRef} onInteriorPointerDown={onInteriorPointerDown} />
      </div>
    </ViewModeProvider>
  );
};

let lockElement: Element | null = null;
const mode = () => screen.getByTestId('mode').textContent;

function setLock(el: Element | null) {
  act(() => {
    lockElement = el;
    document.dispatchEvent(new Event('pointerlockchange'));
  });
}

function move(movementX: number, movementY = 0, timeStamp?: number) {
  act(() => {
    const e = new MouseEvent('mousemove', { bubbles: true });
    // jsdom's MouseEvent ignores movementX/Y in the init dict.
    Object.defineProperty(e, 'movementX', { value: movementX });
    Object.defineProperty(e, 'movementY', { value: movementY });
    if (timeStamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: timeStamp });
    window.dispatchEvent(e);
  });
}

function mouse(type: 'mousedown' | 'mouseup', el: Element | Window, button: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { button, bubbles: true, clientX: 50, clientY: 50 }));
  });
}

const key = (k: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });

describe('CarInputHandler — FREE_LOOK | STEER | UI_INTERACT', () => {
  let requestPointerLock: ReturnType<typeof vi.fn>;
  let exitPointerLock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    lockElement = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => lockElement });
    exitPointerLock = vi.fn();
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: exitPointerLock });
    requestPointerLock = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
      configurable: true,
      value: requestPointerLock,
    });
    povStore.reset({ heading: 34, carHeading: 34, pitch: 0 });
    cabinHeadStore.reset();
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { requestPointerLock?: unknown }).requestPointerLock;
  });

  it('starts in UI_INTERACT, where mouse movement changes nothing', () => {
    render(<Harness />);
    expect(mode()).toBe('UI_INTERACT');
    move(200, 80);
    expect(povStore.get().carHeading).toBe(34);
    expect(cabinHeadStore.get()).toEqual({ headYaw: 0, headPitch: 0 });
  });

  it('a cabin click asks for the lock; the lock lands in STEER and drops the first delta', () => {
    render(<Harness />);
    const cabin = screen.getByTestId('cabin');
    mouse('mousedown', cabin, 0);
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
    expect(mode()).toBe('UI_INTERACT'); // not until the browser grants it

    setLock(cabin);
    expect(mode()).toBe('STEER');

    move(500); // spurious post-lock jump
    expect(povStore.get().carHeading).toBe(34);

    move(20, 30, 1000);
    move(20, 30, 1016);
    expect(povStore.get().carHeading).toBeGreaterThan(34); // mouse right → steer right
    expect(cabinHeadStore.get()).toEqual({ headYaw: 0, headPitch: 0 }); // STEER never moves the head
  });

  it('holding the right button is FREE_LOOK: head only, car untouched', () => {
    render(<Harness />);
    const cabin = screen.getByTestId('cabin');
    setLock(cabin);
    move(1); // eat the post-lock delta

    mouse('mousedown', cabin, 2);
    expect(mode()).toBe('FREE_LOOK');
    move(-100, -40); // mouse left + up
    expect(cabinHeadStore.get().headYaw).toBeGreaterThan(0); // +yaw = look left
    expect(cabinHeadStore.get().headPitch).toBeGreaterThan(0); // +pitch = look up
    expect(povStore.get().carHeading).toBe(34);

    mouse('mouseup', window, 2);
    expect(mode()).toBe('STEER');
  });

  it('F latches FREE_LOOK; Tab goes to UI_INTERACT and back to the latched mode', () => {
    render(<Harness />);
    const cabin = screen.getByTestId('cabin');
    setLock(cabin);
    key('f');
    expect(mode()).toBe('FREE_LOOK');

    key('Tab');
    expect(exitPointerLock).toHaveBeenCalledTimes(1);
    expect(mode()).toBe('UI_INTERACT');
    setLock(null);

    key('Tab');
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
    setLock(cabin);
    expect(mode()).toBe('FREE_LOOK');
  });

  it('Esc (browser releases the lock) lands in UI_INTERACT without console errors', () => {
    const errors = vi.spyOn(console, 'error');
    render(<Harness />);
    const cabin = screen.getByTestId('cabin');
    setLock(cabin);
    mouse('mousedown', cabin, 2);
    expect(mode()).toBe('FREE_LOOK');

    setLock(null);
    expect(mode()).toBe('UI_INTERACT');
    move(300, 300);
    expect(cabinHeadStore.get()).toEqual({ headYaw: 0, headPitch: 0 });
    expect(povStore.get().carHeading).toBe(34);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('a UI_INTERACT click on a dashboard control interacts instead of grabbing the pointer', () => {
    const onInteriorPointerDown = vi.fn(() => true);
    render(<Harness onInteriorPointerDown={onInteriorPointerDown} />);
    mouse('mousedown', screen.getByTestId('cabin'), 0);
    expect(onInteriorPointerDown).toHaveBeenCalledWith(50, 50, true);
    expect(requestPointerLock).not.toHaveBeenCalled();
    expect(mode()).toBe('UI_INTERACT');
  });

  it('a click on a HUD overlay inside the cabin view never grabs the pointer', () => {
    const onInteriorPointerDown = vi.fn(() => false);
    render(<Harness onInteriorPointerDown={onInteriorPointerDown} />);
    const hudButton = document.createElement('button');
    screen.getByTestId('cabin').appendChild(hudButton);
    mouse('mousedown', hudButton, 0);
    expect(requestPointerLock).not.toHaveBeenCalled();
    expect(onInteriorPointerDown).not.toHaveBeenCalled();
    hudButton.remove();
  });

  it('a refused lock request leaves UI_INTERACT in place', () => {
    requestPointerLock.mockImplementation(() => Promise.reject(new Error('no gesture')));
    render(<Harness />);
    mouse('mousedown', screen.getByTestId('cabin'), 0);
    expect(mode()).toBe('UI_INTERACT');
  });

  it('Tab still navigates when focus is on a HUD control; Shift+F (cinema) is not free look', () => {
    render(<Harness />);
    const button = document.createElement('button');
    screen.getByTestId('cabin').appendChild(button);
    button.focus();
    key('Tab');
    expect(requestPointerLock).not.toHaveBeenCalled();
    button.remove();

    setLock(screen.getByTestId('cabin'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', shiftKey: true, bubbles: true }));
    });
    expect(mode()).toBe('STEER');
  });

  it('unmounting (leaving the car view) releases the lock', () => {
    const { unmount } = render(<Harness />);
    setLock(screen.getByTestId('cabin'));
    unmount();
    expect(exitPointerLock).toHaveBeenCalled();
  });
});
