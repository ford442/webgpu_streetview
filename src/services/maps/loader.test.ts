import { loadMapsApi, onMapsAuthFailure } from './loader';

const resetMapsGlobals = () => {
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

    const script = appendSpy.mock.calls[0][0] as HTMLScriptElement;
    const url = new URL(script.src);
    expect(url.origin).toBe('https://maps.googleapis.com');
    expect(url.pathname).toBe('/maps/api/js');
    expect(url.searchParams.get('loading')).toBe('async');
    expect(url.searchParams.get('v')).toBe('weekly');
    expect(url.searchParams.get('callback')).toBe('__initWebGpuStreetviewMaps');
    expect(importedLibraries.sort()).toEqual(['maps', 'marker', 'streetView']);
  });

  it('notifies registered listeners when Google reports an auth failure', () => {
    const listener = jest.fn();
    const unsubscribe = onMapsAuthFailure(listener);

    loadMapsApi('AIzaSyCleanConnectionTestKey').catch(() => undefined);
    window.gm_authFailure?.();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
