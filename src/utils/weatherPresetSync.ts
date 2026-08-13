import type { TimeOfDay } from '../hooks/useEnvironmentSettings';

/**
 * Compact weather preset string for shared-session broadcast.
 * Format: `tod:<day|sunrise|sunset|night>|rain:<0-1>|snow:<0-1>|fog:<0-1>`
 * (segments optional after time-of-day).
 */
export function serializeWeatherPreset(opts: {
  timeOfDay: TimeOfDay;
  rainIntensity?: number;
  snowIntensity?: number;
  fogDensity?: number;
}): string {
  const parts = [`tod:${opts.timeOfDay}`];
  if (opts.rainIntensity !== undefined) parts.push(`rain:${opts.rainIntensity.toFixed(2)}`);
  if (opts.snowIntensity !== undefined) parts.push(`snow:${opts.snowIntensity.toFixed(2)}`);
  if (opts.fogDensity !== undefined) parts.push(`fog:${opts.fogDensity.toFixed(2)}`);
  return parts.join('|');
}

export interface ParsedWeatherPreset {
  timeOfDay?: TimeOfDay;
  rainIntensity?: number;
  snowIntensity?: number;
  fogDensity?: number;
}

const VALID_TOD: TimeOfDay[] = ['day', 'sunrise', 'sunset', 'night'];

export function parseWeatherPreset(raw: string | undefined): ParsedWeatherPreset | null {
  if (!raw?.trim()) return null;
  const result: ParsedWeatherPreset = {};
  for (const segment of raw.split('|')) {
    const [key, val] = segment.split(':');
    if (!key || val === undefined) continue;
    switch (key) {
      case 'tod':
        if (VALID_TOD.includes(val as TimeOfDay)) result.timeOfDay = val as TimeOfDay;
        break;
      case 'rain':
        result.rainIntensity = parseFloat(val);
        break;
      case 'snow':
        result.snowIntensity = parseFloat(val);
        break;
      case 'fog':
        result.fogDensity = parseFloat(val);
        break;
      default:
        break;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
