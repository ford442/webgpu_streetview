import { renderHook, act } from '@testing-library/react';
import { useTouchControls } from '../useTouchControls';
import { useDeviceDetection } from '../useDeviceDetection';

describe('useTouchControls', () => {
  const mockPan = jest.fn();
  const mockZoom = jest.fn();
  const mockDoubleTap = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() =>
      useTouchControls({
        onPan: mockPan,
        onZoom: mockZoom,
        onDoubleTap: mockDoubleTap,
      })
    );

    expect(result.current.gestureState.isDragging).toBe(false);
    expect(result.current.gestureState.isPinching).toBe(false);
    expect(result.current.gestureState.velocityX).toBe(0);
    expect(result.current.gestureState.velocityY).toBe(0);
  });

  it('should handle touch start for single finger drag', () => {
    const { result } = renderHook(() =>
      useTouchControls({ onPan: mockPan })
    );

    const touchEvent = {
      preventDefault: jest.fn(),
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as React.TouchEvent;

    act(() => {
      result.current.bindTouchEvents.onTouchStart(touchEvent);
    });

    expect(result.current.gestureState.isDragging).toBe(true);
    expect(result.current.gestureState.lastTouchX).toBe(100);
    expect(result.current.gestureState.lastTouchY).toBe(100);
  });

  it('should handle touch start for two finger pinch', () => {
    const { result } = renderHook(() =>
      useTouchControls({ onZoom: mockZoom })
    );

    const touchEvent = {
      preventDefault: jest.fn(),
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 200 },
      ],
    } as unknown as React.TouchEvent;

    act(() => {
      result.current.bindTouchEvents.onTouchStart(touchEvent);
    });

    expect(result.current.gestureState.isPinching).toBe(true);
    expect(result.current.gestureState.touchStartDistance).toBeCloseTo(141.4, 0);
  });

  it('should handle touch move for pan', () => {
    const { result } = renderHook(() =>
      useTouchControls({ onPan: mockPan, panSensitivity: 0.5 })
    );

    // Start drag
    act(() => {
      result.current.bindTouchEvents.onTouchStart({
        preventDefault: jest.fn(),
        touches: [{ clientX: 100, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });

    // Move
    act(() => {
      result.current.bindTouchEvents.onTouchMove({
        preventDefault: jest.fn(),
        touches: [{ clientX: 150, clientY: 120 }],
      } as unknown as React.TouchEvent);
    });

    expect(mockPan).toHaveBeenCalledWith(25, 10); // (150-100)*0.5, (120-100)*0.5
  });

  it('should handle touch move for pinch zoom', () => {
    const { result } = renderHook(() =>
      useTouchControls({ onZoom: mockZoom })
    );

    // Start pinch
    act(() => {
      result.current.bindTouchEvents.onTouchStart({
        preventDefault: jest.fn(),
        touches: [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 200 },
        ],
      } as unknown as React.TouchEvent);
    });

    // Pinch out
    act(() => {
      result.current.bindTouchEvents.onTouchMove({
        preventDefault: jest.fn(),
        touches: [
          { clientX: 90, clientY: 90 },
          { clientX: 210, clientY: 210 },
        ],
      } as unknown as React.TouchEvent);
    });

    expect(mockZoom).toHaveBeenCalled();
  });

  it('should detect double tap', () => {
    jest.useFakeTimers();
    const { result } = renderHook(() =>
      useTouchControls({ onDoubleTap: mockDoubleTap, doubleTapDelay: 300 })
    );

    // First tap
    act(() => {
      result.current.bindTouchEvents.onTouchStart({
        preventDefault: jest.fn(),
        touches: [{ clientX: 100, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });

    act(() => {
      result.current.bindTouchEvents.onTouchEnd({
        preventDefault: jest.fn(),
        changedTouches: [{ clientX: 100, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });

    // Second tap within delay
    act(() => {
      jest.advanceTimersByTime(100);
    });

    act(() => {
      result.current.bindTouchEvents.onTouchStart({
        preventDefault: jest.fn(),
        touches: [{ clientX: 100, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });

    act(() => {
      result.current.bindTouchEvents.onTouchEnd({
        preventDefault: jest.fn(),
        changedTouches: [{ clientX: 100, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });

    expect(mockDoubleTap).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('should be disabled when enabled is false', () => {
    const { result } = renderHook(() =>
      useTouchControls({ enabled: false, onPan: mockPan })
    );

    act(() => {
      result.current.bindTouchEvents.onTouchStart({
        preventDefault: jest.fn(),
        touches: [{ clientX: 100, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });

    expect(result.current.gestureState.isDragging).toBe(false);
  });
});

describe('useDeviceDetection', () => {
  const originalNavigator = global.navigator;
  const originalWindow = global.window;

  beforeEach(() => {
    // Mock window properties
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 667, writable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: 2 });
    Object.defineProperty(window, 'ontouchstart', { value: {} });
  });

  afterEach(() => {
    global.navigator = originalNavigator;
  });

  it('should detect mobile device', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
      writable: true,
    });

    const { result } = renderHook(() => useDeviceDetection());

    expect(result.current.device.isMobile).toBe(true);
    expect(result.current.device.isDesktop).toBe(false);
    expect(result.current.device.isTouchDevice).toBe(true);
  });

  it('should detect desktop device', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
      writable: true,
    });

    Object.defineProperty(window, 'ontouchstart', { value: undefined });

    const { result } = renderHook(() => useDeviceDetection());

    expect(result.current.device.isDesktop).toBe(true);
    expect(result.current.device.isMobile).toBe(false);
  });

  it('should provide quality settings for mobile', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
      writable: true,
    });

    const { result } = renderHook(() => useDeviceDetection());

    expect(result.current.quality.renderScale).toBeLessThanOrEqual(0.75);
    expect(result.current.quality.frameRate).toBeLessThanOrEqual(30);
  });

  it('should toggle battery save mode', () => {
    const { result } = renderHook(() => useDeviceDetection());

    act(() => {
      result.current.setBatterySaveMode(true);
    });

    expect(result.current.quality.batterySaveMode).toBe(true);
    expect(result.current.quality.frameRate).toBeLessThanOrEqual(24);
    expect(result.current.quality.renderScale).toBeLessThanOrEqual(0.6);
  });

  it('should reset to optimal quality', () => {
    const { result } = renderHook(() => useDeviceDetection());

    act(() => {
      result.current.setBatterySaveMode(true);
    });

    expect(result.current.quality.batterySaveMode).toBe(true);

    act(() => {
      result.current.resetToOptimal();
    });

    expect(result.current.quality.batterySaveMode).toBe(false);
  });

  it('should update screen size on resize', () => {
    const { result } = renderHook(() => useDeviceDetection());

    act(() => {
      window.innerWidth = 1024;
      window.innerHeight = 768;
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.device.screenSize.width).toBe(1024);
    expect(result.current.device.screenSize.height).toBe(768);
  });
});
