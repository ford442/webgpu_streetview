import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RAIN_DARKEN_DAY, RAIN_DARKEN_NIGHT } from './weatherCohesion';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

describe('WebGL must-match parity (night floor, precip Y, overcast, rain darken, haze)', () => {
  const webgl = read('./WebGLFallbackRenderer.ts');
  const fragment = read('../../public/shaders/weather-post.wgsl');
  const compute = read('../../public/shaders/weather-post-compute.wgsl');

  it('keeps rain darken day/night coefficients aligned across all three paths', () => {
    expect(RAIN_DARKEN_DAY).toBe(0.22);
    expect(RAIN_DARKEN_NIGHT).toBe(0.10);
    const token = `mix(${RAIN_DARKEN_DAY}, ${RAIN_DARKEN_NIGHT}`;
    expect(fragment).toContain(token);
    expect(compute).toContain(token);
    expect(webgl).toContain(`mix(${RAIN_DARKEN_DAY.toFixed(2)}, ${RAIN_DARKEN_NIGHT.toFixed(2)}`);
  });

  it('applies humidity haze in the WebGL fallback (must-match atmosphere)', () => {
    expect(webgl).toContain('vec3 applyHumidityHaze');
    expect(webgl).toContain('uWeather[31]');
    expect(webgl).toContain('smoothstep(0.7, 0.2, uv.y)');
    expect(webgl).toContain('vec3(0.75, 0.82, 0.88)');
    expect(fragment).toContain('fn applyHumidityHaze');
    expect(compute).toContain('fn applyHumidityHaze');
  });

  it('keeps precipitation falling downward in WebGL (negative Y time term)', () => {
    expect(webgl).toContain('-time * 24.0');
    expect(webgl).toContain('-time * 2.2');
    expect(fragment).toContain('st.y = st.y - t *');
  });

  it('documents that overcast sun kill is CPU-side (weatherCohesion) for all backends', () => {
    expect(webgl).toContain('weatherCohesion.ts');
    expect(webgl).toContain('uWeather[28]');
    expect(webgl).toContain('uWeather[26]');
  });
});
