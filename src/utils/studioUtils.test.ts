import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serializeWeatherPreset, parseWeatherPreset } from './weatherPresetSync';

describe('weatherPresetSync', () => {
  it('round-trips time-of-day and weather intensities', () => {
    const raw = serializeWeatherPreset({
      timeOfDay: 'night',
      rainIntensity: 0.6,
      snowIntensity: 0.2,
      fogDensity: 0.1,
    });
    expect(parseWeatherPreset(raw)).toEqual({
      timeOfDay: 'night',
      rainIntensity: 0.6,
      snowIntensity: 0.2,
      fogDensity: 0.1,
    });
  });

  it('returns null for empty preset', () => {
    expect(parseWeatherPreset('')).toBeNull();
    expect(parseWeatherPreset(undefined)).toBeNull();
  });
});

describe('iceServers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete (window as Window & { TURN_URL?: string }).TURN_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('always includes STUN', async () => {
    const { resolveIceServers } = await import('./iceServers');
    const servers = resolveIceServers();
    expect(servers.some((s) => String(s.urls).includes('stun:'))).toBe(true);
  });

  it('adds TURN when REACT_APP_TURN_URL is set', async () => {
    process.env.REACT_APP_TURN_URL = 'turn:example.com:3478';
    process.env.REACT_APP_TURN_USERNAME = 'u';
    process.env.REACT_APP_TURN_CREDENTIAL = 'p';
    const { resolveIceServers, hasTurnConfigured } = await import('./iceServers');
    const servers = resolveIceServers();
    expect(hasTurnConfigured()).toBe(true);
    expect(servers).toHaveLength(2);
    expect(servers[1]?.urls).toBe('turn:example.com:3478');
    expect(servers[1]?.username).toBe('u');
  });
});

describe('canvasRecorder', () => {
  it('reports unsupported when MediaRecorder missing', async () => {
    const { isClipRecordingSupported } = await import('./canvasRecorder');
    const original = globalThis.MediaRecorder;
    // @ts-expect-error test shim
    delete globalThis.MediaRecorder;
    expect(isClipRecordingSupported()).toBe(false);
    globalThis.MediaRecorder = original;
  });
});
