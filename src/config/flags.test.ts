// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLAGS,
  hasFlag,
  parseBoolToken,
  readAllFlags,
  readFlag,
  readSearchParams,
  type FlagName,
} from './flags';

const BOOL_FLAGS = (Object.keys(FLAGS) as FlagName[]).filter((n) => FLAGS[n].kind === 'bool');

describe('parseBoolToken (the one truthiness grammar)', () => {
  it.each(['', '1', 'true', 'TRUE', 'on', 'On', 'yes'])('%j is true', (v) => {
    expect(parseBoolToken(v)).toBe(true);
  });
  it.each(['0', 'false', 'FALSE', 'off', 'Off', 'no'])('%j is false', (v) => {
    expect(parseBoolToken(v)).toBe(false);
  });
  it.each(['maybe', '2', 'enabled', 'auto'])('%j is unset', (v) => {
    expect(parseBoolToken(v)).toBeUndefined();
  });
  it('absent is unset', () => {
    expect(parseBoolToken(null)).toBeUndefined();
    expect(parseBoolToken(undefined)).toBeUndefined();
  });
});

describe('every bool flag shares the same truthiness', () => {
  it.each(BOOL_FLAGS)('?%s', (name) => {
    const def = FLAGS[name] as { default?: boolean };
    for (const on of ['', '=', '=1', '=true', '=on', '=yes', '=ON']) {
      expect(readFlag(name, `?${name}${on === '' ? '' : on}`), `${name}${on}`).toBe(true);
    }
    for (const off of ['=0', '=false', '=off', '=no', '=OFF']) {
      expect(readFlag(name, `?${name}${off}`), `${name}${off}`).toBe(false);
    }
    // absent / junk → the declared default (possibly undefined)
    expect(readFlag(name, '')).toBe(def.default);
    expect(readFlag(name, `?${name}=banana`)).toBe(def.default);
  });
});

describe('flag-specific behaviour', () => {
  it('portal defaults to enabled and only falls back on an explicit off', () => {
    expect(readFlag('portal', '')).toBe(true);
    expect(readFlag('portal', '?portal')).toBe(true);
    expect(readFlag('portal', '?portal=off')).toBe(false);
    expect(readFlag('portal', '?portal=0')).toBe(false);
  });

  it('kill switches default to false and accept bare presence', () => {
    expect(readFlag('no_gpu_compute', '')).toBe(false);
    expect(readFlag('no_gpu_compute', '?no_gpu_compute')).toBe(true);
    expect(readFlag('no_clip_distances', '?no_clip_distances=0')).toBe(false);
  });

  it('tri flags map bool spellings to on/off and keep auto', () => {
    expect(readFlag('hdr', '')).toBe('off');
    expect(readFlag('hdr', '?hdr')).toBe('on');
    expect(readFlag('hdr', '?hdr=1')).toBe('on');
    expect(readFlag('hdr', '?hdr=true')).toBe('on');
    expect(readFlag('hdr', '?hdr=auto')).toBe('auto');
    expect(readFlag('hdr', '?hdr=0')).toBe('off');
    expect(readFlag('hdr', '?hdr=nonsense')).toBe('off');
    expect(readFlag('p3', '?p3=AUTO')).toBe('auto');
  });

  it('enum flags are case-insensitive and ignore unknown values', () => {
    expect(readFlag('cabin', '?cabin=WebGL')).toBe('webgl');
    expect(readFlag('cabin', '?cabin=webgl2')).toBeUndefined();
    expect(readFlag('weather', '?weather=compute')).toBe('compute');
    expect(readFlag('quality', '?quality=ULTRA')).toBe('ultra');
    expect(readFlag('quality', '?quality=extreme')).toBeUndefined();
    expect(readFlag('effect', '?effect=fog')).toBe('fog');
  });

  it('tokens flags split, trim, lowercase and drop empties', () => {
    expect(readFlag('gpu', '')).toEqual([]);
    expect(readFlag('gpu', '?gpu=High, Compat,,features')).toEqual(['high', 'compat', 'features']);
  });

  it('accepts a search string with or without the leading ?', () => {
    expect(readFlag('wireframe', 'wireframe=1')).toBe(true);
    expect(readFlag('wireframe', '?wireframe=1')).toBe(true);
  });

  it('hasFlag reports raw presence regardless of value', () => {
    expect(hasFlag('webgl', '?webgl=0')).toBe(true);
    expect(hasFlag('webgl', '?webgpu')).toBe(false);
  });

  it('readAllFlags resolves the whole table', () => {
    const all = readAllFlags('?hdr=auto&portal=off&gpu=high');
    expect(all.hdr).toBe('auto');
    expect(all.portal).toBe(false);
    expect(all.gpu).toEqual(['high']);
    expect(Object.keys(all).sort()).toEqual(Object.keys(FLAGS).sort());
  });

  it('readSearchParams never throws', () => {
    expect(readSearchParams('?a=1').get('a')).toBe('1');
    expect(readSearchParams('').toString()).toBe('');
  });
});

describe('number flags (schema kind)', () => {
  it('parses, clamps and defaults', () => {
    // No numeric flag ships yet; exercise the kind through the exported parser path.
    const fake = { kind: 'number', default: 3, min: 1, max: 5, doc: '' } as const;
    (FLAGS as Record<string, unknown>).__n = fake;
    try {
      expect(readFlag('__n' as FlagName, '?__n=4')).toBe(4);
      expect(readFlag('__n' as FlagName, '?__n=99')).toBe(5);
      expect(readFlag('__n' as FlagName, '?__n=-9')).toBe(1);
      expect(readFlag('__n' as FlagName, '?__n=abc')).toBe(3);
      expect(readFlag('__n' as FlagName, '')).toBe(3);
    } finally {
      delete (FLAGS as Record<string, unknown>).__n;
    }
  });
});

// ── Repo-wide guards ──────────────────────────────────────────────────────────
const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no other module parses the query string', () => {
  const files = walk(SRC).filter((f) => path.basename(f) !== 'flags.ts');

  it('never reads location.search directly', () => {
    const offenders = files.filter((f) => /location\.search/.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('only builds URLSearchParams from an object literal or empty (outgoing queries)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(fs.readFileSync(f, 'utf8'));
      for (const m of code.matchAll(/new URLSearchParams\(\s*([^)\s])/g)) {
        if (m[1] !== '{') offenders.push(`${path.relative(SRC, f)}: new URLSearchParams(${m[1]}…`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('docs/FLAGS.md', () => {
  it('is generated from the schema (run `npm run gen:flags-doc`)', () => {
    const root = path.resolve(SRC, '..');
    expect(() =>
      execFileSync(process.execPath, [path.join(root, 'scripts/gen-flags-doc.mjs'), '--check'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
