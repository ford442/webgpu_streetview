import {
  CARTO_VOYAGER_URL,
  applyCesiumIonToken,
  createCartoBaseLayer,
  createIonWorldBaseLayer,
  getCesiumIonToken,
  resolveGlobeBaseLayer,
  resolveGlobeImagerySource,
  resolveMiniMapLayerOptions,
} from './cesiumImagery';

function makeMockCesium(opts?: { ionThrows?: boolean; terrainRejects?: boolean }) {
  const ion = { defaultAccessToken: '' as string };
  const UrlTemplateImageryProvider = function (this: { opts: unknown }, o: unknown) {
    this.opts = o;
  };
  const ImageryLayer = function (this: { provider: unknown }, provider: unknown) {
    this.provider = provider;
  } as unknown as {
    new (provider: unknown): { provider: unknown };
    fromWorldImagery: () => { kind: string };
  };
  ImageryLayer.fromWorldImagery = () => {
    if (opts?.ionThrows) throw new Error('ion boom');
    return { kind: 'ion-world' };
  };

  return {
    Ion: ion,
    UrlTemplateImageryProvider,
    ImageryLayer,
    EllipsoidTerrainProvider: function (this: { kind: string }) {
      this.kind = 'ellipsoid';
    },
    createWorldTerrainAsync: async () => {
      if (opts?.terrainRejects) throw new Error('terrain boom');
      return { kind: 'world-terrain' };
    },
  };
}

describe('cesiumImagery', () => {
  it('getCesiumIonToken trims and defaults empty', () => {
    expect(getCesiumIonToken('  tok  ')).toBe('tok');
    expect(getCesiumIonToken('')).toBe('');
    // Explicit empty override — do not call with `undefined` (that uses process.env default)
    expect(getCesiumIonToken('   ')).toBe('');
  });

  it('resolveGlobeImagerySource prefers ion when token present', () => {
    expect(resolveGlobeImagerySource('abc')).toBe('ion');
    expect(resolveGlobeImagerySource('')).toBe('carto');
  });

  it('applyCesiumIonToken sets Ion.defaultAccessToken only when non-empty', () => {
    const Cesium = makeMockCesium();
    expect(applyCesiumIonToken(Cesium, '')).toBe('');
    expect(Cesium.Ion.defaultAccessToken).toBe('');
    expect(applyCesiumIonToken(Cesium, 'secret')).toBe('secret');
    expect(Cesium.Ion.defaultAccessToken).toBe('secret');
  });

  it('createCartoBaseLayer uses CartoCDN Voyager URL', () => {
    const Cesium = makeMockCesium();
    const layer = createCartoBaseLayer(Cesium) as { provider: { opts: { url: string } } };
    expect(layer.provider.opts.url).toBe(CARTO_VOYAGER_URL);
  });

  it('resolveGlobeBaseLayer uses Ion when token env is set', () => {
    const Cesium = makeMockCesium();
    const prev = process.env.REACT_APP_CESIUM_ION_TOKEN;
    process.env.REACT_APP_CESIUM_ION_TOKEN = 'ion-token';
    try {
      const layer = resolveGlobeBaseLayer(Cesium);
      expect(layer).toEqual({ kind: 'ion-world' });
      expect(Cesium.Ion.defaultAccessToken).toBe('ion-token');
    } finally {
      if (prev === undefined) delete process.env.REACT_APP_CESIUM_ION_TOKEN;
      else process.env.REACT_APP_CESIUM_ION_TOKEN = prev;
    }
  });

  it('resolveGlobeBaseLayer falls back to Carto when no token', () => {
    const Cesium = makeMockCesium();
    const prev = process.env.REACT_APP_CESIUM_ION_TOKEN;
    delete process.env.REACT_APP_CESIUM_ION_TOKEN;
    try {
      const layer = resolveGlobeBaseLayer(Cesium) as { provider: { opts: { url: string } } };
      expect(layer.provider.opts.url).toBe(CARTO_VOYAGER_URL);
    } finally {
      if (prev === undefined) delete process.env.REACT_APP_CESIUM_ION_TOKEN;
      else process.env.REACT_APP_CESIUM_ION_TOKEN = prev;
    }
  });

  it('resolveGlobeBaseLayer falls back to Carto if Ion construction throws', () => {
    const Cesium = makeMockCesium({ ionThrows: true });
    const prev = process.env.REACT_APP_CESIUM_ION_TOKEN;
    process.env.REACT_APP_CESIUM_ION_TOKEN = 'bad-token';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const layer = resolveGlobeBaseLayer(Cesium) as { provider: { opts: { url: string } } };
      expect(layer.provider.opts.url).toBe(CARTO_VOYAGER_URL);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      if (prev === undefined) delete process.env.REACT_APP_CESIUM_ION_TOKEN;
      else process.env.REACT_APP_CESIUM_ION_TOKEN = prev;
    }
  });

  it('createIonWorldBaseLayer delegates to ImageryLayer.fromWorldImagery', () => {
    const Cesium = makeMockCesium();
    expect(createIonWorldBaseLayer(Cesium)).toEqual({ kind: 'ion-world' });
  });

  it('resolveMiniMapLayerOptions uses Ion terrain when token works', async () => {
    const Cesium = makeMockCesium();
    const prev = process.env.REACT_APP_CESIUM_ION_TOKEN;
    process.env.REACT_APP_CESIUM_ION_TOKEN = 'ion-token';
    try {
      const opts = await resolveMiniMapLayerOptions(Cesium);
      expect(opts.imagerySource).toBe('ion');
      expect(opts.terrainProvider).toEqual({ kind: 'world-terrain' });
      expect(opts.baseLayer).toEqual({ kind: 'ion-world' });
    } finally {
      if (prev === undefined) delete process.env.REACT_APP_CESIUM_ION_TOKEN;
      else process.env.REACT_APP_CESIUM_ION_TOKEN = prev;
    }
  });

  it('resolveMiniMapLayerOptions falls back to ellipsoid+Carto when terrain fails', async () => {
    const Cesium = makeMockCesium({ terrainRejects: true });
    const prev = process.env.REACT_APP_CESIUM_ION_TOKEN;
    process.env.REACT_APP_CESIUM_ION_TOKEN = 'ion-token';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const opts = await resolveMiniMapLayerOptions(Cesium);
      expect(opts.imagerySource).toBe('carto');
      expect(opts.terrainProvider).toEqual({ kind: 'ellipsoid' });
      expect((opts.baseLayer as { provider: { opts: { url: string } } }).provider.opts.url).toBe(
        CARTO_VOYAGER_URL,
      );
    } finally {
      warn.mockRestore();
      if (prev === undefined) delete process.env.REACT_APP_CESIUM_ION_TOKEN;
      else process.env.REACT_APP_CESIUM_ION_TOKEN = prev;
    }
  });
});
