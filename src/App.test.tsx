import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { vi } from 'vitest';
import App from './App';
import type { MapsLoadStatus } from './components/StreetView';

const streetViewApiKeys: string[] = [];
const mockMapsAuthListeners: Array<(event: { key: string; currentKey: string; source: string }) => void> = [];
const mockLoadMapsApi = vi.fn((_apiKey: string) => Promise.resolve());
const mockRemoveFailedBootstrap = vi.fn();
const mockClearAuthFailure = vi.fn((_forKey?: string) => undefined);
let mockLatestStreetViewStatusChange: ((status: MapsLoadStatus) => void) | undefined;
let mockLatestStreetViewCanvasReady: ((canvas: HTMLCanvasElement) => void) | undefined;

vi.mock('./components/StreetView', () => {
  return {
    __esModule: true,
    default: function MockStreetView({
      apiKey,
      onStatusChange,
      onCanvasReady,
    }: {
      apiKey: string;
      onStatusChange?: (status: MapsLoadStatus) => void;
      onCanvasReady?: (canvas: HTMLCanvasElement) => void;
    }) {
      streetViewApiKeys.push(apiKey);
      mockLatestStreetViewStatusChange = onStatusChange;
      mockLatestStreetViewCanvasReady = onCanvasReady;
      return <div data-testid="mock-street-view" data-api-key={apiKey} />;
    },
  };
});

vi.mock('./components/WebGPUCanvas', () => {
  return {
    __esModule: true,
    default: function MockWebGPUCanvas({
      onWebGPUStatus,
      onBackendInfo,
    }: {
      onWebGPUStatus?: (available: boolean) => void;
      onBackendInfo?: (info: { backendType: 'webgpu' | 'webgl' | null; fallbackReason?: string }) => void;
    }) {
      React.useEffect(() => {
        onWebGPUStatus?.(true);
        onBackendInfo?.({ backendType: 'webgpu' });
      }, [onWebGPUStatus, onBackendInfo]);
      return <div data-testid="mock-webgpu-canvas" />;
    },
  };
});

vi.mock('./car', () => ({
  initCarMode: vi.fn(() => null),
  toggleCarMode: vi.fn(),
  disposeCarMode: vi.fn(),
}));

vi.mock('./services/maps/loader', () => ({
  clearAuthFailure: (forKey?: string) => mockClearAuthFailure(forKey),
  loadMapsApi: (apiKey: string) => mockLoadMapsApi(apiKey),
  removeFailedBootstrap: () => mockRemoveFailedBootstrap(),
  onMapsAuthFailure: (cb: (event: { key: string; currentKey: string; source: string }) => void) => {
    mockMapsAuthListeners.push(cb);
    return () => {
      const idx = mockMapsAuthListeners.indexOf(cb);
      if (idx !== -1) mockMapsAuthListeners.splice(idx, 1);
    };
  },
}));

describe('App', () => {
  beforeEach(() => {
    streetViewApiKeys.length = 0;
    mockMapsAuthListeners.length = 0;
    mockLoadMapsApi.mockClear();
    mockLoadMapsApi.mockResolvedValue(undefined);
    mockRemoveFailedBootstrap.mockClear();
    mockClearAuthFailure.mockClear();
    mockLatestStreetViewStatusChange = undefined;
    mockLatestStreetViewCanvasReady = undefined;
    window.MAPS_API_KEY = '';
  });

  it('renders without crashing', () => {
    render(<App />);
  });

  it('renders the Street View mount point', () => {
    render(<App />);
    expect(screen.getByTestId('mock-street-view')).toBeInTheDocument();
  });

  it('initially shows welcome modal', () => {
    render(<App />);
    expect(screen.getByText('1ink.us Streetview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Exploring/i })).toBeInTheDocument();
  });

  it('shows a missing key error and picks up a late runtime key without reload', async () => {
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('No Google Maps API key is configured');
    expect(screen.getByTestId('mock-street-view')).toHaveAttribute('data-api-key', '');

    window.MAPS_API_KEY = 'late-runtime-key';
    act(() => {
      window.dispatchEvent(new CustomEvent('maps-api-key-ready'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-street-view')).toHaveAttribute('data-api-key', 'late-runtime-key');
    });
    expect(screen.queryByText(/No Google Maps API key is configured/i)).not.toBeInTheDocument();
    expect(streetViewApiKeys).toContain('');
    expect(streetViewApiKeys).toContain('late-runtime-key');
  });

  it('shows granular loading states and hides after rendering starts', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Start Exploring/i }));

    window.MAPS_API_KEY = 'runtime-key';
    act(() => {
      window.dispatchEvent(new CustomEvent('maps-api-key-ready'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('mock-street-view')).toHaveAttribute('data-api-key', 'runtime-key');
    });

    act(() => mockLatestStreetViewStatusChange?.('loading-api'));
    expect(screen.getByText('Connecting to Google Maps...')).toBeInTheDocument();

    act(() => mockLatestStreetViewStatusChange?.('api-ready'));
    expect(screen.getByText('Google Maps connected. Preparing Street View...')).toBeInTheDocument();

    act(() => mockLatestStreetViewStatusChange?.('loading-panorama'));
    expect(screen.getByText('Loading Street View...')).toBeInTheDocument();

    act(() => mockLatestStreetViewStatusChange?.('canvas-ready'));
    expect(screen.getByText('Preparing WebGPU renderer...')).toBeInTheDocument();

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'width', { value: 512 });
    Object.defineProperty(canvas, 'height', { value: 512 });
    act(() => mockLatestStreetViewCanvasReady?.(canvas));

    await waitFor(() => {
      expect(screen.getByTestId('mock-webgpu-canvas')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText('Preparing WebGPU renderer...')).not.toBeInTheDocument();
    });
  });

  it('shows the renderer backend indicator once the backend is known', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Start Exploring/i }));

    window.MAPS_API_KEY = 'runtime-key';
    act(() => {
      window.dispatchEvent(new CustomEvent('maps-api-key-ready'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('mock-street-view')).toHaveAttribute('data-api-key', 'runtime-key');
    });

    act(() => mockLatestStreetViewStatusChange?.('canvas-ready'));

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'width', { value: 512 });
    Object.defineProperty(canvas, 'height', { value: 512 });
    act(() => mockLatestStreetViewCanvasReady?.(canvas));

    await waitFor(() => {
      expect(screen.getByText(/WebGPU/i)).toBeInTheDocument();
    });
  });

  it('distinguishes canvas timeout from API loading', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Start Exploring/i }));

    window.MAPS_API_KEY = 'runtime-key';
    act(() => {
      window.dispatchEvent(new CustomEvent('maps-api-key-ready'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('mock-street-view')).toHaveAttribute('data-api-key', 'runtime-key');
    });

    act(() => mockLatestStreetViewStatusChange?.('canvas-timeout'));

    expect(screen.getByText('Street View unavailable at this location.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows a blocking auth error overlay and retries Maps with the current runtime key', async () => {
    render(<App />);

    act(() => {
      mockMapsAuthListeners.forEach(listener => listener({
        key: 'runtime-key',
        currentKey: 'runtime-key',
        source: 'gm_authFailure',
      }));
    });

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Google Maps API key error');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('check referrer restrictions');
    expect(screen.getByRole('button', { name: /Retry Maps/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload page/i })).toBeInTheDocument();

    window.MAPS_API_KEY = 'fixed-runtime-key';
    fireEvent.click(screen.getByRole('button', { name: /Retry Maps/i }));

    await waitFor(() => {
      expect(mockLoadMapsApi).toHaveBeenCalledWith('fixed-runtime-key');
    });
    expect(mockRemoveFailedBootstrap).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('auto-recovers from a failed old key when a corrected runtime key is injected', async () => {
    window.MAPS_API_KEY = 'bad-runtime-key';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Start Exploring/i }));

    act(() => {
      window.dispatchEvent(new CustomEvent('maps-api-key-ready'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('mock-street-view')).toHaveAttribute('data-api-key', 'bad-runtime-key');
    });

    act(() => {
      mockMapsAuthListeners.forEach(listener => listener({
        key: 'bad-runtime-key',
        currentKey: 'bad-runtime-key',
        source: 'gm_authFailure',
      }));
    });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Google Maps API key error');

    window.MAPS_API_KEY = 'fixed-runtime-key';
    act(() => {
      window.dispatchEvent(new CustomEvent('maps-api-key-ready'));
    });

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Retrying with new Maps key');
    expect(screen.getByText('Retrying with new key...')).toBeInTheDocument();

    act(() => mockLatestStreetViewStatusChange?.('api-ready'));
    expect(screen.getByText('New key accepted. Preparing Street View...')).toBeInTheDocument();

    act(() => mockLatestStreetViewStatusChange?.('canvas-ready'));
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'width', { value: 512 });
    Object.defineProperty(canvas, 'height', { value: 512 });
    act(() => mockLatestStreetViewCanvasReady?.(canvas));

    await waitFor(() => {
      expect(screen.getByTestId('mock-webgpu-canvas')).toBeInTheDocument();
    });
    expect(mockClearAuthFailure).toHaveBeenCalledWith('fixed-runtime-key');
    expect(mockRemoveFailedBootstrap).toHaveBeenCalled();
    expect(mockLoadMapsApi).not.toHaveBeenCalledWith('fixed-runtime-key');
  });

  it('unsubscribes the Maps auth failure listener on unmount', () => {
    const { unmount } = render(<App />);

    expect(mockMapsAuthListeners).toHaveLength(1);
    unmount();
    expect(mockMapsAuthListeners).toHaveLength(0);
  });
});
