/**
 * Typed registry + single parser for every URL query flag (`?hdr=1`, `?cabin=webgl`, …).
 *
 * Why one module: ~30 flags used to be parsed in 15+ files, each with its own
 * `new URLSearchParams(...)` and its own idea of "truthy" (`?no_gpu_compute` was
 * presence, `?portal` only `off|0|false`, `?p3` only `1|true|on|auto`, …).
 *
 * Grammar (uniform for every `bool` flag):
 *   true   — bare presence (`?flag`, `?flag=`) or `1 | true | on | yes`
 *   false  — `0 | false | off | no`
 *   unset  — absent, or an unrecognised value (falls back to the flag's default)
 * Values are case-insensitive. `enum` / `tri` flags accept their listed values
 * (`tri` additionally maps the bool spellings to `on`/`off`); anything else is
 * unset. `tokens` flags are comma-separated lists (`?gpu=high,compat`). `string`
 * flags are a raw payload (trimmed, case kept); their owner validates them.
 *
 * The flag table in `docs/FLAGS.md` is generated from FLAGS (`npm run gen:flags-doc`);
 * `flags.test.ts` fails when it drifts and when any other file under src/ parses
 * the query string itself.
 */

export interface BoolFlagDef {
  kind: 'bool';
  default?: boolean;
  doc: string;
}
export interface EnumFlagDef<V extends string = string> {
  kind: 'enum';
  values: readonly V[];
  default?: V;
  doc: string;
}
/** `on | off | auto`; `1/true/yes` read as `on`, `0/false/no` as `off`. */
export interface TriFlagDef {
  kind: 'tri';
  default?: 'on' | 'off' | 'auto';
  doc: string;
}
export interface NumberFlagDef {
  kind: 'number';
  default?: number;
  min?: number;
  max?: number;
  doc: string;
}
export interface TokensFlagDef {
  kind: 'tokens';
  /** Documented token vocabulary (informational; unknown tokens are preserved). */
  values?: readonly string[];
  doc: string;
}
/** Raw payload (trimmed, case preserved); empty reads as unset. The owning module validates it. */
export interface StringFlagDef {
  kind: 'string';
  /** Shape of the payload, for docs/FLAGS.md. */
  format: string;
  doc: string;
}
export type FlagDef = BoolFlagDef | EnumFlagDef | TriFlagDef | NumberFlagDef | TokensFlagDef | StringFlagDef;

export const FLAGS = {
  // ── Renderer / device ────────────────────────────────────────────────────
  renderer: {
    kind: 'enum', values: ['auto', 'webgpu', 'webgl'],
    doc: 'Backend preference. WebGL weather is a reference only; boot still probes WebGPU.',
  },
  webgl: { kind: 'bool', doc: 'Shorthand for `?renderer=webgl`.' },
  webgpu: { kind: 'bool', doc: 'Shorthand for `?renderer=webgpu`.' },
  gpu: {
    kind: 'tokens',
    values: ['low', 'low-power', 'high', 'high-performance', 'fallback', 'software', 'compat', 'compatibility', 'features'],
    doc: 'Adapter selection tokens, e.g. `?gpu=high,compat`. `features` dumps enabled optional features on the backend chip.',
  },
  hdr: {
    kind: 'tri', default: 'off',
    doc: 'Output-referred HDR canvas (extended tone mapping + rgba16float). `auto` follows the display.',
  },
  p3: {
    kind: 'tri', default: 'off',
    doc: 'Display-P3 canvas colour space (also colours the cabin overlay). `auto` follows the display.',
  },
  weather: {
    kind: 'enum', values: ['fragment', 'compute'],
    doc: 'Weather post-process pipeline. Wins over the persisted choice and the quality preset.',
  },
  quality: {
    kind: 'enum', values: ['low', 'medium', 'high', 'ultra'],
    doc: 'Visual quality preset. Wins over the persisted choice and hardware auto-detection.',
  },
  effect: {
    kind: 'enum', values: ['all', 'raw', 'color', 'weather', 'fog', 'night', 'lighting'],
    doc: 'Isolate a single post-process effect (debug).',
  },
  debug: { kind: 'enum', values: ['wireframe'], doc: '`?debug=wireframe` is an alias for `?wireframe`.' },
  wireframe: { kind: 'bool', default: false, doc: 'Wireframe overlay (debug).' },
  legacyTransitions: {
    kind: 'bool',
    doc: 'Force the legacy CPU-timed panorama transition (on) or the GPU transition (off).',
  },
  no_gpu_compute: {
    kind: 'bool', default: false,
    doc: 'Kill switch for GPU chores (luma/horizon compute). Weather rendering is unaffected.',
  },
  no_clip_distances: {
    kind: 'bool', default: false,
    doc: 'Do not request the `clip-distances` device feature (also disables the windshield portal).',
  },
  // ── Cabin / car ──────────────────────────────────────────────────────────
  cabin: {
    kind: 'enum', values: ['webgl', 'webgpu'],
    doc: 'Cabin overlay backend. Default follows the WebGPU probe; `webgl` is the escape hatch.',
  },
  portal: {
    kind: 'bool', default: true,
    doc: 'Windshield portal. `?portal=off` forces the hole + decal overlay.',
  },
  gltfInterior: {
    kind: 'bool',
    doc: 'Use the authored glTF interior kit. Turning it on persists to localStorage.',
  },
  // ── Trips ────────────────────────────────────────────────────────────────
  route: {
    kind: 'string', format: 'lat,lng;lat,lng[;…]',
    doc: 'Routed road trip link: origin, optional via-points, destination (`services/routing/routeLink.ts`). Plans the route on load; Drive starts it.',
  },
  liveWeather: {
    kind: 'bool',
    doc: 'Live local conditions (Open-Meteo weather at the pano). `on`/`off` win over the weather panel\'s persisted toggle; unset defers to it (off by default).',
  },
  // ── WASM feeders ─────────────────────────────────────────────────────────
  wasmNoise: {
    kind: 'bool',
    doc: 'WASM-driven noise effect. `off` disables it; unset defers to localStorage, then on.',
  },
  wasmParticles: {
    kind: 'bool',
    doc: 'WASM GPU particle field. `off` disables it; unset defers to localStorage, then on.',
  },
} as const satisfies Record<string, FlagDef>;

export type FlagName = keyof typeof FLAGS;

type TriValue = 'on' | 'off' | 'auto';

/** Value type of a flag: `T` when the def declares a default, else `T | undefined`. */
export type FlagValue<N extends FlagName> = (typeof FLAGS)[N] extends infer D
  ? D extends { kind: 'bool'; default: boolean } ? boolean
  : D extends { kind: 'bool' } ? boolean | undefined
  : D extends { kind: 'tri'; default: TriValue } ? TriValue
  : D extends { kind: 'tri' } ? TriValue | undefined
  : D extends { kind: 'enum'; values: readonly (infer V)[]; default: string } ? V
  : D extends { kind: 'enum'; values: readonly (infer V)[] } ? V | undefined
  : D extends { kind: 'number'; default: number } ? number
  : D extends { kind: 'number' } ? number | undefined
  : D extends { kind: 'tokens' } ? string[]
  : D extends { kind: 'string' } ? string | undefined
  : never
  : never;

const TRUE_TOKENS: ReadonlySet<string> = new Set(['1', 'true', 'on', 'yes']);
const FALSE_TOKENS: ReadonlySet<string> = new Set(['0', 'false', 'off', 'no']);

/**
 * Parse one raw query value. `null` (absent) and unrecognised values are
 * `undefined`; bare presence (`''`) is `true`.
 */
export function parseBoolToken(raw: string | null | undefined): boolean | undefined {
  if (raw === null || raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === '') return true;
  if (TRUE_TOKENS.has(v)) return true;
  if (FALSE_TOKENS.has(v)) return false;
  return undefined;
}

/** `window.location.search`, or `''` where there is no window (SSR / node tests). */
export function currentSearch(): string {
  return typeof window !== 'undefined' ? window.location.search : '';
}

/**
 * The only place a `URLSearchParams` is built from a location/search string.
 * Accepts a leading `?`. Never throws — malformed input yields empty params.
 * Payload links (`look`, `lat/lng`, `year`, …) use this too; typed *flags* go
 * through `readFlag`.
 */
export function readSearchParams(search: string = currentSearch()): URLSearchParams {
  try {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return new URLSearchParams();
  }
}

function parseFlag(def: FlagDef, raw: string | null): unknown {
  switch (def.kind) {
    case 'bool': {
      const b = parseBoolToken(raw);
      return b === undefined ? def.default : b;
    }
    case 'tri': {
      if (raw === null) return def.default;
      const v = raw.trim().toLowerCase();
      if (v === 'auto') return 'auto';
      const b = parseBoolToken(raw);
      if (b === undefined) return def.default;
      return b ? 'on' : 'off';
    }
    case 'enum': {
      const v = raw?.trim().toLowerCase();
      return v && (def.values as readonly string[]).includes(v) ? v : def.default;
    }
    case 'number': {
      if (raw === null || raw.trim() === '') return def.default;
      const n = Number(raw);
      if (!Number.isFinite(n)) return def.default;
      return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n));
    }
    case 'string': {
      const v = raw?.trim();
      return v ? v : undefined;
    }
    case 'tokens':
      return (raw ?? '')
        .toLowerCase()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
  }
}

/** Read one flag. `search` defaults to the live `window.location.search`. */
export function readFlag<N extends FlagName>(name: N, search?: string): FlagValue<N> {
  const params = readSearchParams(search);
  return parseFlag(FLAGS[name], params.get(name)) as FlagValue<N>;
}

/** True when the query string carries the flag at all (any value, even junk). */
export function hasFlag(name: FlagName, search?: string): boolean {
  return readSearchParams(search).has(name);
}

/** Every flag, resolved. Handy for diagnostics / a dev flags panel. */
export function readAllFlags(search?: string): { [N in FlagName]: FlagValue<N> } {
  const params = readSearchParams(search);
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(FLAGS) as FlagName[]) {
    out[name] = parseFlag(FLAGS[name], params.get(name));
  }
  return out as { [N in FlagName]: FlagValue<N> };
}
