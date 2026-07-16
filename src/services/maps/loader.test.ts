import { clearAuthFailure, loadMapsApi, onMapsAuthFailure } from './loader';

const resetMapsGlobals = () => {
  clearAuthFailure();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete (window as any).google;
  delete (window as any).gm_authFailure;
  delete (window as any).__mapsApiLoadState;
  delete (window as any).__initWebGpuStreetviewMaps;
};

describe('loadMapsApi', () => {
  beforeEach(() => {
    resetMapsGlobals();
    jest.useRealTimers();
  });

  afterEach(() => {
    resetMapsGlobals();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects empty and placeholder API keys without injecting a script', async () => {
    await expect(loadMapsApi('')).rejects.toThrow('key is empty');
    await expect(loadMapsApi('YOUR_MAPS_API_KEY')).rejects.toThrow('placeholder value detected');

    expect(document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')).toBeNull();
  });

  it('injects the async dynamic-library bootstrap and imports app libraries once', async () => {
    const importedLibraries: string[] = [];
    const appendSpy = jest.spyOn(document.head, 'appendChild');

    appendSpy.mockImplementation((node: Node) => {
      const script = node as HTMLScriptElement;
      setTimeout(() => {
        (window as any).google = {
          maps: {
            importLibrary: jest.fn((libraryName: string) => {
              importedLibraries.push(libraryName);
              return Promise.resolve({});
            }),
          },
        };
        (window as any).__initWebGpuStreetviewMaps?.();
      }, 0);
      return script;
    });

    const promise = loadMapsApi('AIzaSyCleanConnectionTestKey');
    const secondPromise = loadMapsApi('AIzaSyCleanConnectionTestKey');

    expect(secondPromise).toBe(promise);

    await promise;

    const script = appendSpy.mock.calls[0]![0] as HTMLScriptElement;
    const url = new URL(script.src);
    expect(url.origin).toBe('https://maps.googleapis.com');
    expect(url.pathname).toBe('/maps/api/js');
    expect(url.searchParams.get('loading')).toBe('async');
    expect(url.searchParams.get('v')).toBe('weekly');
    expect(url.searchParams.get('callback')).toBe('__initWebGpuStreetviewMaps');
    expect(importedLibraries.sort()).toEqual(['maps', 'streetView']);
  });

  it('notifies registered listeners when Google reports an auth failure', () => {
    const listener = jest.fn();
    const unsubscribe = onMapsAuthFailure(listener);

    loadMapsApi('AIzaSyCleanConnectionTestKey').catch(() => undefined);
    window.gm_authFailure?.();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      key: 'AIzaSyCleanConnectionTestKey',
      currentKey: 'AIzaSyCleanConnectionTestKey',
      source: 'gm_authFailure',
    }));
    unsubscribe();
  });

  it('supports key-scoped auth failure listeners', () => {
    const currentKeyListener = jest.fn();
    const oldKeyListener = jest.fn();
    const unsubscribeCurrent = onMapsAuthFailure(currentKeyListener, { forKey: 'AIzaSyCurrentRuntimeKey' });
    const unsubscribeOld = onMapsAuthFailure(oldKeyListener, { forKey: 'AIzaSyOldRuntimeKey' });

    loadMapsApi('AIzaSyOldRuntimeKey').catch(() => undefined);
    window.gm_authFailure?.();

    expect(oldKeyListener).toHaveBeenCalledTimes(1);
    expect(currentKeyListener).not.toHaveBeenCalled();
    unsubscribeCurrent();
    unsubscribeOld();
  });

  it('rejects the load promise when Google reports an auth failure during bootstrap', async () => {
    const appendSpy = jest.spyOn(document.head, 'appendChild');

    appendSpy.mockImplementation((node: Node) => {
      const script = node as HTMLScriptElement;
      setTimeout(() => {
        window.gm_authFailure?.();
      }, 0);
      return script;
    });

    await expect(loadMapsApi('AIzaSyCleanConnectionTestKey')).rejects.toThrow(
      'Google Maps authentication failed'
    );
  });

  it('clears auth failure state and drops spurious gm_authFailure shortly after success', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    const listener = jest.fn();
    const unsubscribe = onMapsAuthFailure(listener);
    const appendSpy = jest.spyOn(document.head, 'appendChild');

    appendSpy.mockImplementation((node: Node) => {
      const script = node as HTMLScriptElement;
      setTimeout(() => {
        (window as any).google = {
          maps: {
            Map: function MockMap() {},
            StreetViewPanorama: function MockStreetViewPanorama() {},
            importLibrary: jest.fn(() => Promise.resolve({})),
          },
        };
        (window as any).__initWebGpuStreetviewMaps?.();
      }, 0);
      return script;
    });

    const promise = loadMapsApi('AIzaSyCleanConnectionTestKey');
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await promise;

    window.gm_authFailure?.();
    expect(listener).not.toHaveBeenCalled();

    jest.setSystemTime(2500);
    window.gm_authFailure?.();
    expect(listener).toHaveBeenCalledTimes(1);

    clearAuthFailure('AIzaSyCleanConnectionTestKey');
    unsubscribe();
  });
});
