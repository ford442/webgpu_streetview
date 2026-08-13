import {
  LOOK_IDS,
  LOOK_PACKS,
  diffLookOverrides,
  getLookPack,
  isLookId,
  lookPackMatchesState,
  lookPackToEnvPatch,
  resolveLookEnv,
} from './lookPacks';
import { packWeatherParams } from '../renderer/packWeatherParams';
import { resolveCinematicCameraFx } from '../renderer/cinematicCameraFx';
import { WEATHER_PARAMS_FLOAT_COUNT, WeatherParamIndex } from '../renderer/weatherUniformLayout';

describe('look packs', () => {
  it('ships at least four named artistic looks with before/after notes', () => {
    const artistic = LOOK_IDS.filter((id) => id !== 'clear');
    expect(artistic.length).toBeGreaterThanOrEqual(4);
    expect(LOOK_IDS).toHaveLength(8);
    for (const id of LOOK_IDS) {
      const pack = LOOK_PACKS[id];
      expect(pack.id).toBe(id);
      expect(pack.name.length).toBeGreaterThan(0);
      expect(pack.before.length).toBeGreaterThan(10);
      expect(pack.after.length).toBeGreaterThan(10);
      expect(pack.curve.shadows.length).toBeGreaterThan(0);
      expect(pack.curve.mids.length).toBeGreaterThan(0);
      expect(pack.curve.highlights.length).toBeGreaterThan(0);
    }
  });

  it('lookPackToEnvPatch is a lossless flatten of slider fields', () => {
    const pack = LOOK_PACKS.noir;
    const patch = lookPackToEnvPatch(pack);
    expect(patch.rainIntensity).toBe(pack.rain);
    expect(patch.timeOfDay).toBe('night');
    expect(patch.headlightsOn).toBe(true);
    expect(patch.wipersEnabled).toBe(true);
    expect(patch.shaderEffectsEnabled).toBe(true);
    expect(patch.autoNightMode).toBe(false);
    expect(lookPackMatchesState(pack, patch)).toBe(true);
  });

  it('resolveLookEnv applies overrides on top of a named pack', () => {
    const resolved = resolveLookEnv(LOOK_PACKS.noir, { rainIntensity: 40 });
    expect(resolved.rainIntensity).toBe(40);
    expect(resolved.saturation).toBe(LOOK_PACKS.noir.saturation);
    expect(resolved.headlightsOn).toBe(true);
  });

  it('diffLookOverrides only reports changed fields', () => {
    const base = lookPackToEnvPatch(LOOK_PACKS.storm);
    expect(diffLookOverrides(LOOK_PACKS.storm, base)).toEqual({});
    const diffs = diffLookOverrides(LOOK_PACKS.storm, { ...base, rainIntensity: 40 });
    expect(diffs).toEqual({ rainIntensity: 40 });
  });

  it('rejects unknown look ids', () => {
    expect(isLookId('noir')).toBe(true);
    expect(isLookId('sepia')).toBe(false);
    expect(getLookPack('sepia')).toBeNull();
  });

  it('packs every look into the 40-float weather layout', () => {
    for (const id of LOOK_IDS) {
      const patch = lookPackToEnvPatch(LOOK_PACKS[id]);
      const params = packWeatherParams({
        env: {
          vibrance: patch.vibrance,
          saturation: patch.saturation,
          contrast: patch.contrast,
          exposure: patch.exposure,
          temperature: patch.temperature,
          tint: patch.tint,
          rainIntensity: patch.rainIntensity,
          snowIntensity: patch.snowIntensity,
          wind: patch.wind,
          nightIntensity: patch.nightIntensity,
          headlightsOn: patch.headlightsOn,
          highBeam: patch.highBeam,
          domeLightOn: patch.domeLightOn,
          sunAzimuth: 0,
          sunAltitude: patch.timeOfDay === 'night' ? -1 : 0.6,
          moonAzimuth: 0,
          moonAltitude: 0,
          fogDensity: patch.fogDensity,
          shaderEffectsEnabled: true,
          timeOfDay: patch.timeOfDay,
        },
        timeSeconds: 0,
        cameraHeading: 0.5,
        cameraPitch: 0.5,
        wasmNoiseActive: false,
      });
      expect(params.length).toBe(WEATHER_PARAMS_FLOAT_COUNT);
      expect(params[WeatherParamIndex.shaderEffectsEnabled]).toBe(1);
    }
  });

  it('does not let reduced motion strip look grading (cinematic extras stay off)', () => {
    const patch = lookPackToEnvPatch(LOOK_PACKS.noir);
    const cinematic = resolveCinematicCameraFx({
      quality: 'ultra',
      reducedMotion: true,
      speedNormalized: 1,
    });
    const params = packWeatherParams({
      env: {
        vibrance: patch.vibrance,
        saturation: patch.saturation,
        contrast: patch.contrast,
        exposure: patch.exposure,
        temperature: patch.temperature,
        tint: patch.tint,
        rainIntensity: patch.rainIntensity,
        snowIntensity: patch.snowIntensity,
        wind: patch.wind,
        nightIntensity: patch.nightIntensity,
        headlightsOn: patch.headlightsOn,
        highBeam: patch.highBeam,
        domeLightOn: patch.domeLightOn,
        sunAzimuth: 0,
        sunAltitude: -1,
        moonAzimuth: 0,
        moonAltitude: 0.5,
        fogDensity: patch.fogDensity,
        shaderEffectsEnabled: true,
        timeOfDay: 'night',
      },
      timeSeconds: 0,
      cameraHeading: 0.5,
      cameraPitch: 0.5,
      wasmNoiseActive: false,
      cinematic,
    });
    const I = WeatherParamIndex;
    expect(params[I.vibrance]).toBeCloseTo(patch.vibrance - 1);
    expect(params[I.saturation]).toBeCloseTo(patch.saturation - 1);
    expect(params[I.contrast]).toBeCloseTo(patch.contrast - 1);
    expect(params[I.nightIntensity]).toBe(1);
    expect(params[I.rainIntensity]).toBeGreaterThan(0);
    expect(params[I.dofStrength]).toBe(0);
    expect(params[I.motionBlurStrength]).toBe(0);
  });
});
