// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { useDeviceDetection } from '../useDeviceDetection';

describe('useDeviceDetection', () => {
  const originalNavigator = global.navigator;
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    // Mock window properties
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 667, writable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: 2 });
    Object.defineProperty(window, 'ontouchstart', { value: {}, configurable: true });
  });

  afterEach(() => {
    global.navigator = originalNavigator;
    // Individual tests mutate navigator.userAgent; restore it so later tests
    // (which don't set their own) don't inherit a previous test's device type.
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, writable: true });
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

    Object.defineProperty(window, 'ontouchstart', { value: undefined, configurable: true });

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
