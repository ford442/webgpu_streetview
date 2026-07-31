import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readShader(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shaders', name), 'utf8');
}

function extractFunctionBody(source: string, functionName: string): string {
  const signature = `fn ${functionName}(`;
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`Function ${functionName} not found`);
  }

  const openBrace = source.indexOf('{', start);
  if (openBrace === -1) {
    throw new Error(`Function ${functionName} has no opening brace`);
  }

  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(openBrace + 1, i);
    }
  }

  throw new Error(`Function ${functionName} has unbalanced braces`);
}

function normalizeWgsl(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}();,+\-*/=<>])\s*/g, '$1')
    .trim();
}

function normalizeSnowBody(code: string): string {
  return normalizeWgsl(code)
    .replace('let wind=p_wind();', '')
    .replace('let snowInt=p_snowIntensity();', '')
    .replace(/p\.wind/g, 'wind')
    .replace(/p\.snowIntensity/g, 'snowInt');
}

describe('weather shader parity guard', () => {
  it('keeps applyNight identical between fragment and compute paths', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    const fragmentNight = normalizeWgsl(extractFunctionBody(fragment, 'applyNight'));
    const computeNight = normalizeWgsl(extractFunctionBody(compute, 'applyNight'));

    expect(computeNight).toBe(fragmentNight);
  });

  it('keeps snow motion math aligned between fragment and compute paths', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    const fragmentSnow = normalizeSnowBody(extractFunctionBody(fragment, 'snow'));
    const computeSnow = normalizeSnowBody(extractFunctionBody(compute, 'snow'));

    expect(computeSnow).toBe(fragmentSnow);
  });

  it('keeps night headlight multipliers aligned across WGSL paths', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    const fragmentMatch = fragment.match(/let\s+nightMul\s*=\s*mix\(0\.55,\s*1\.15,\s*p\.nightIntensity\)/);
    const computeMatch = compute.match(/let\s+nightMul\s*=\s*mix\(0\.55,\s*1\.15,\s*p_nightIntensity\(\)\)/);

    expect(fragmentMatch).not.toBeNull();
    expect(computeMatch).not.toBeNull();
  });
});
