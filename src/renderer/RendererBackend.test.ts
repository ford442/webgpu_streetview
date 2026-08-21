import {
  getAdapterPowerPreferencePolicy,
  getAdapterRequestOptions,
  getAdapterSelectionPolicy,
  getCanvasOutputFlags,
  exposeRendererDebugGlobals,
  getLegacyTransitionsEnabled,
  getRendererDebugOptions,
  getRendererPreference,
  RendererDebugOptions,
} from './RendererBackend';

const setSearch = (search: string) => {
  window.history.pushState({}, '', `/${search}`);
};

const resetGlobals = () => {
  setSearch('');
  localStorage.clear();
  delete (window as any).rendererType;
  delete (window as any).usingWebGPU;
  delete (window as any).usingWebGL;
  delete (window as any).rendererFallbackReason;
  delete (window as any).streetViewRendererDebug;
};

describe('getRendererPreference', () => {
  beforeEach(resetGlobals);
  afterEach(resetGlobals);

  it('defaults to auto with no params or storage', () => {
    expect(getRendererPreference()).toBe('auto');
  });

  it('reads ?renderer=webgpu and ?renderer=webgl', () => {
    setSearch('?renderer=webgpu');
    expect(getRendererPreference()).toBe('webgpu');
    setSearch('?renderer=webgl');
    expect(getRendererPreference()).toBe('webgl');
  });

  it('falls back to auto for an invalid ?renderer= value', () => {
    setSearch('?renderer=bogus');
    expect(getRendererPreference()).toBe('auto');
  });

  it('honors legacy bare ?webgl and ?webgpu flags', () => {
    setSearch('?webgl');
    expect(getRendererPreference()).toBe('webgl');
    setSearch('?webgpu');
    expect(getRendererPreference()).toBe('webgpu');
  });

  it('prefers ?renderer= over legacy flags when both are present', () => {
    setSearch('?renderer=webgpu&webgl');
    expect(getRendererPreference()).toBe('webgpu');
  });

  it('uses localStorage when no query param is present', () => {
    localStorage.setItem('streetview.renderer', 'webgl');
    expect(getRendererPreference()).toBe('webgl');
  });

  it('prefers a query param over a stored localStorage preference', () => {
    localStorage.setItem('streetview.renderer', 'webgl');
    setSearch('?renderer=webgpu');
    expect(getRendererPreference()).toBe('webgpu');
  });

  it('ignores an invalid stored localStorage value', () => {
    localStorage.setItem('streetview.renderer', 'bogus');
    expect(getRendererPreference()).toBe('auto');
  });

  it('falls back to auto when localStorage access throws', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(getRendererPreference()).toBe('auto');
    getItemSpy.mockRestore();
  });
});

describe('getRendererDebugOptions', () => {
  beforeEach(resetGlobals);
  afterEach(resetGlobals);

  it('defaults to all/no-wireframe with no params or storage', () => {
    expect(getRendererDebugOptions()).toEqual({ effectIsolation: 'all', wireframe: false });
  });

  describe('getLegacyTransitionsEnabled', () => {
    beforeEach(resetGlobals);
    afterEach(resetGlobals);

    it('defaults to false when no query flag is set', () => {
      expect(getLegacyTransitionsEnabled(false)).toBe(false);
    });

    it('honors ?legacyTransitions=1 and ?legacyTransitions=true', () => {
      setSearch('?legacyTransitions=1');
      expect(getLegacyTransitionsEnabled(false)).toBe(true);
      setSearch('?legacyTransitions=true');
      expect(getLegacyTransitionsEnabled(false)).toBe(true);
    });

    it('honors explicit false values', () => {
      setSearch('?legacyTransitions=0');
      expect(getLegacyTransitionsEnabled(true)).toBe(false);
      setSearch('?legacyTransitions=false');
      expect(getLegacyTransitionsEnabled(true)).toBe(false);
    });
  });

  describe('getAdapterRequestOptions', () => {
    beforeEach(resetGlobals);
    afterEach(resetGlobals);

    it('defaults to empty options when no override or URL policy is present', () => {
      expect(getAdapterRequestOptions()).toEqual({});
      expect(getAdapterPowerPreferencePolicy().source).toBe('default');
    });

    it('maps ?gpu=low and ?gpu=high to WebGPU power preferences', () => {
      setSearch('?gpu=low');
      expect(getAdapterRequestOptions()).toEqual({ powerPreference: 'low-power' });

      setSearch('?gpu=high');
      expect(getAdapterRequestOptions()).toEqual({ powerPreference: 'high-performance' });
    });

    it('prefers init-option override over URL policy', () => {
      setSearch('?gpu=low');
      expect(getAdapterRequestOptions({ powerPreference: 'high-performance' })).toEqual({
        powerPreference: 'high-performance',
      });
      expect(getAdapterPowerPreferencePolicy({ powerPreference: 'high-performance' }).source).toBe('override');
    });
  });

  it('reads ?effect=', () => {
    setSearch('?effect=weather');
    expect(getRendererDebugOptions().effectIsolation).toBe('weather');
  });

  it('falls back to all for an invalid ?effect= value', () => {
    setSearch('?effect=bogus');
    expect(getRendererDebugOptions().effectIsolation).toBe('all');
  });

  it('uses localStorage when no ?effect= param is present', () => {
    localStorage.setItem('streetview.effect', 'fog');
    expect(getRendererDebugOptions().effectIsolation).toBe('fog');
  });

  it('prefers a query param over a stored effect preference', () => {
    localStorage.setItem('streetview.effect', 'fog');
    setSearch('?effect=night');
    expect(getRendererDebugOptions().effectIsolation).toBe('night');
  });

  it('treats a bare ?wireframe flag as enabled', () => {
    setSearch('?wireframe');
    expect(getRendererDebugOptions().wireframe).toBe(true);
  });

  it('treats ?debug=wireframe as enabled', () => {
    setSearch('?debug=wireframe');
    expect(getRendererDebugOptions().wireframe).toBe(true);
  });

  it('defaults wireframe to false when neither flag is present', () => {
    expect(getRendererDebugOptions().wireframe).toBe(false);
  });
});

describe('exposeRendererDebugGlobals', () => {
  // jsdom defines `reload` as a non-configurable, non-writable own property
  // of the Location object (hardening against accidental real navigation),
  // so it can't be patched in place. Replace `window.location` wholesale for
  // this describe block instead — none of these tests need real URL/search
  // behavior, only a spy-able `reload()`.
  let reloadSpy: ReturnType<typeof jest.fn>;
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;

  beforeEach(() => {
    resetGlobals();
    reloadSpy = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: reloadSpy },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', originalLocationDescriptor);
    resetGlobals();
  });

  it('sets the four window globals for the webgpu backend', () => {
    exposeRendererDebugGlobals('webgpu', undefined, { effectIsolation: 'all', wireframe: false }, jest.fn());
    expect(window.rendererType).toBe('webgpu');
    expect(window.usingWebGPU).toBe(true);
    expect(window.usingWebGL).toBe(false);
    expect(window.rendererFallbackReason).toBe('');
  });

  it('sets the four window globals for the webgl backend with a fallback reason', () => {
    exposeRendererDebugGlobals('webgl', 'WebGPU unavailable', { effectIsolation: 'all', wireframe: false }, jest.fn());
    expect(window.rendererType).toBe('webgl');
    expect(window.usingWebGPU).toBe(false);
    expect(window.usingWebGL).toBe(true);
    expect(window.rendererFallbackReason).toBe('WebGPU unavailable');
  });

  it('getBackend() mirrors the exposed globals', () => {
    exposeRendererDebugGlobals('webgl', 'reason', { effectIsolation: 'all', wireframe: false }, jest.fn());
    expect(window.streetViewRendererDebug?.getBackend()).toEqual({
      rendererType: 'webgl',
      usingWebGPU: false,
      usingWebGL: true,
      rendererFallbackReason: 'reason',
    });
  });

  it('setBackend persists the choice and reloads for a valid value', () => {
    exposeRendererDebugGlobals('webgpu', undefined, { effectIsolation: 'all', wireframe: false }, jest.fn());
    window.streetViewRendererDebug?.setBackend('webgl');
    expect(localStorage.getItem('streetview.renderer')).toBe('webgl');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('setBackend is a no-op for an invalid value', () => {
    exposeRendererDebugGlobals('webgpu', undefined, { effectIsolation: 'all', wireframe: false }, jest.fn());
    window.streetViewRendererDebug?.setBackend('bogus' as any);
    expect(localStorage.getItem('streetview.renderer')).toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('setEffectIsolation persists and applies live without reloading', () => {
    const applyDebugOptions = jest.fn();
    exposeRendererDebugGlobals('webgl', undefined, { effectIsolation: 'all', wireframe: false }, applyDebugOptions);
    window.streetViewRendererDebug?.setEffectIsolation('fog');
    expect(localStorage.getItem('streetview.effect')).toBe('fog');
    expect(applyDebugOptions).toHaveBeenCalledWith({ effectIsolation: 'fog' });
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('setEffectIsolation is a no-op for an invalid value', () => {
    const applyDebugOptions = jest.fn();
    exposeRendererDebugGlobals('webgl', undefined, { effectIsolation: 'all', wireframe: false }, applyDebugOptions);
    window.streetViewRendererDebug?.setEffectIsolation('bogus' as any);
    expect(applyDebugOptions).not.toHaveBeenCalled();
  });

  it('setWireframe applies live without persisting or reloading', () => {
    const applyDebugOptions = jest.fn();
    exposeRendererDebugGlobals('webgl', undefined, { effectIsolation: 'all', wireframe: false }, applyDebugOptions);
    window.streetViewRendererDebug?.setWireframe(true);
    expect(applyDebugOptions).toHaveBeenCalledWith({ wireframe: true });
    expect(localStorage.getItem('streetview.wireframe')).toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('getDebugOptions reflects updates applied to the underlying options object', () => {
    const debugOptions: RendererDebugOptions = { effectIsolation: 'all', wireframe: false };
    const applyDebugOptions = jest.fn((next: Partial<RendererDebugOptions>) => Object.assign(debugOptions, next));
    exposeRendererDebugGlobals('webgl', undefined, debugOptions, applyDebugOptions);

    expect(window.streetViewRendererDebug?.getDebugOptions()).toEqual({ effectIsolation: 'all', wireframe: false });
    window.streetViewRendererDebug?.setWireframe(true);
    expect(window.streetViewRendererDebug?.getDebugOptions()).toEqual({ effectIsolation: 'all', wireframe: true });
  });
});

describe('getAdapterSelectionPolicy', () => {
  beforeEach(resetGlobals);
  afterEach(resetGlobals);

  it('defaults to core with no fallback adapter', () => {
    expect(getAdapterSelectionPolicy()).toEqual({
      forceFallbackAdapter: false,
      featureLevel: 'core',
      featureLevelSource: 'default',
    });
  });

  it('reads ?gpu=fallback and ?gpu=compat', () => {
    setSearch('?gpu=fallback');
    expect(getAdapterSelectionPolicy().forceFallbackAdapter).toBe(true);

    setSearch('?gpu=compat');
    const compat = getAdapterSelectionPolicy();
    expect(compat.featureLevel).toBe('compatibility');
    expect(compat.featureLevelSource).toBe('url');
  });

  it('accepts a combined token list alongside the power preference', () => {
    setSearch('?gpu=high,compat,fallback');
    expect(getAdapterPowerPreferencePolicy()).toEqual({
      powerPreference: 'high-performance',
      source: 'url',
    });
    expect(getAdapterSelectionPolicy()).toEqual({
      forceFallbackAdapter: true,
      featureLevel: 'compatibility',
      featureLevelSource: 'url',
    });
  });
});

describe('getCanvasOutputFlags', () => {
  beforeEach(resetGlobals);
  afterEach(resetGlobals);

  it('defaults both opt-ins to off so a default boot stays SDR sRGB', () => {
    expect(getCanvasOutputFlags()).toEqual({ hdr: 'off', p3: 'off' });
  });

  it('reads ?hdr=1 / ?p3=1 and the auto form', () => {
    setSearch('?hdr=1&p3=auto');
    expect(getCanvasOutputFlags()).toEqual({ hdr: 'on', p3: 'auto' });

    setSearch('?hdr=0&p3=true');
    expect(getCanvasOutputFlags()).toEqual({ hdr: 'off', p3: 'on' });
  });

  it('treats an unrecognized value as off', () => {
    setSearch('?hdr=bogus');
    expect(getCanvasOutputFlags().hdr).toBe('off');
  });
});
