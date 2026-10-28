import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  GENERATED_PRECACHE_URLS,
  STATIC_PRECACHE_URLS,
  buildPrecacheUrls,
  listShaderUrls,
  stampServiceWorker,
  swCacheId,
} from '../../scripts/sw-manifest.mjs';
import { DEPTH_MODEL_CACHE_NAME } from '../renderer/depth/depthModel';
import { CACHE_PREFIX, isOfflineCacheName } from './swPolicy';

const publicDir = path.resolve(__dirname, '../../public');
const swSource = readFileSync(path.join(publicDir, 'service-worker.js'), 'utf8');

describe('service worker precache + versioning', () => {
  it('names only files that exist (cache.addAll rejects wholesale on one 404)', () => {
    const missing = buildPrecacheUrls(publicDir)
      .filter((url) => !GENERATED_PRECACHE_URLS.includes(url))
      .filter((url) => !existsSync(path.join(publicDir, url)));
    expect(missing).toEqual([]);
  });

  it('precaches every shipped shader', () => {
    const onDisk: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(path.join(publicDir, rel), { withFileTypes: true })) {
        const next = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(next);
        else if (entry.name.endsWith('.wgsl')) onDisk.push(`./${next}`);
      }
    };
    walk('shaders');
    expect(listShaderUrls(publicDir)).toEqual(onDisk.sort());
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it('keeps the worker source in sync with the static list and the policy prefix', () => {
    for (const url of STATIC_PRECACHE_URLS) expect(swSource).toContain(`'${url}'`);
    expect(swSource).toContain(`const CACHE_PREFIX = '${CACHE_PREFIX}';`);
  });

  it('never lets the cache sweep reach the depth-model bucket', () => {
    expect(DEPTH_MODEL_CACHE_NAME.startsWith(CACHE_PREFIX)).toBe(false);
    expect(isOfflineCacheName(DEPTH_MODEL_CACHE_NAME)).toBe(false);
  });

  describe('cache id', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'sw-manifest-'));
      cpSync(path.join(publicDir, 'shaders'), path.join(dir, 'shaders'), { recursive: true });
      cpSync(path.join(publicDir, 'wasm'), path.join(dir, 'wasm'), { recursive: true });
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('is stable, and changes with a wasm byte, a shader byte or the build version', () => {
      const base = swCacheId(dir, 'abc1234');
      expect(base).toMatch(/^[0-9a-f]{12}$/);
      expect(swCacheId(dir, 'abc1234')).toBe(base);
      expect(swCacheId(dir, 'def5678')).not.toBe(base);

      const wasm = path.join(dir, 'wasm/streetview-wasm.wasm');
      const original = readFileSync(wasm);
      writeFileSync(wasm, Buffer.concat([original, Buffer.from([0])]));
      const afterWasm = swCacheId(dir, 'abc1234');
      expect(afterWasm).not.toBe(base);
      writeFileSync(wasm, original);

      const shader = path.join(dir, 'shaders/streetview.wgsl');
      writeFileSync(shader, `${readFileSync(shader, 'utf8')}\n// edit`);
      const afterShader = swCacheId(dir, 'abc1234');
      expect(afterShader).not.toBe(base);
      expect(afterShader).not.toBe(afterWasm);
    });
  });

  describe('stamping', () => {
    it('rewrites the id and the shader list, and is idempotent', () => {
      const stamped = stampServiceWorker(swSource, {
        cacheId: 'aaaaaaaaaaaa',
        shaderUrls: ['./shaders/a.wgsl'],
      });
      expect(stamped).toContain(`const CACHE_ID = "aaaaaaaaaaaa";`);
      expect(stamped).toContain(`const SHADER_URLS = ["./shaders/a.wgsl"];`);
      const again = stampServiceWorker(stamped, { cacheId: 'bbbbbbbbbbbb', shaderUrls: [] });
      expect(again).toContain(`const CACHE_ID = "bbbbbbbbbbbb";`);
      expect(again).not.toContain('aaaaaaaaaaaa');
    });

    it('refuses a worker that lost its stamp lines (never ships the dev id)', () => {
      expect(() =>
        stampServiceWorker('const CACHE_ID = "dev";', { cacheId: 'x', shaderUrls: [] }),
      ).toThrow(/@sw-stamp/);
    });
  });
});
