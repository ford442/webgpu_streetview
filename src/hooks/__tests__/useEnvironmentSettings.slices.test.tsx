// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  EnvironmentSettingsProvider,
  useCarEnvSettings,
  useEnvironmentSettings,
  useGradeSettings,
  useLightingSettings,
  useWeatherSettings,
} from '../useEnvironmentSettings';

type Api = ReturnType<typeof useEnvironmentSettings>;

function setup() {
  const renders = { weather: 0, grade: 0, lighting: 0, car: 0, all: 0 };
  let api!: Api;
  function Weather() { useWeatherSettings(); renders.weather += 1; return null; }
  function Grade() { useGradeSettings(); renders.grade += 1; return null; }
  function Lighting() { useLightingSettings(); renders.lighting += 1; return null; }
  function Car() { useCarEnvSettings(); renders.car += 1; return null; }
  function All() { api = useEnvironmentSettings(); renders.all += 1; return null; }
  render(
    <EnvironmentSettingsProvider>
      <Weather /><Grade /><Lighting /><Car /><All />
    </EnvironmentSettingsProvider>,
  );
  return { renders, api: () => api, snapshot: () => ({ ...renders }) };
}

describe('EnvironmentSettings slices', () => {
  it('a weather change re-renders only weather (and aggregate) consumers', () => {
    const { renders, api, snapshot } = setup();
    const before = snapshot();
    act(() => api().setRainIntensity(40));
    expect(renders.weather).toBe(before.weather + 1);
    expect(renders.all).toBe(before.all + 1);
    expect(renders.grade).toBe(before.grade);
    expect(renders.lighting).toBe(before.lighting);
    expect(renders.car).toBe(before.car);
  });

  it('a grade change leaves weather / lighting / car consumers alone', () => {
    const { renders, api, snapshot } = setup();
    const before = snapshot();
    act(() => api().setVibrance(1.4));
    expect(renders.grade).toBe(before.grade + 1);
    expect(renders.weather).toBe(before.weather);
    expect(renders.lighting).toBe(before.lighting);
    expect(renders.car).toBe(before.car);
  });

  it('astronomy updates (auto-night) only touch lighting consumers', () => {
    const { renders, api, snapshot } = setup();
    const before = snapshot();
    act(() => {
      api().setSunAltitude(0.3);
      api().setNightIntensity(0.4);
    });
    expect(renders.lighting).toBe(before.lighting + 1);
    expect(renders.weather).toBe(before.weather);
    expect(renders.grade).toBe(before.grade);
    expect(renders.car).toBe(before.car);
  });

  it('setting an unchanged value renders nothing', () => {
    const { api, snapshot } = setup();
    const before = snapshot();
    act(() => api().setRainIntensity(0));
    expect(snapshot()).toEqual(before);
  });

  it('the aggregate exposes every field the old single context did', () => {
    const { api } = setup();
    const keys = Object.keys(api());
    for (const k of [
      'rainIntensity', 'setRainIntensity', 'timeOfDay', 'autoNightMode', 'nightIntensity',
      'sunAltitude', 'moonIntensity', 'wipersEnabled', 'headlightsOn', 'highBeam', 'domeLightOn',
      'isRoofOpen', 'vibrance', 'exposure', 'shaderEffectsEnabled', 'autoExposureEnabled',
      'applyTimeOfDayPreset', 'applyColorGradingPreset', 'activeLookId', 'applyLookPack',
      'ambientLightColor',
    ]) {
      expect(keys).toContain(k);
    }
  });
});
