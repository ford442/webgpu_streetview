# URL flags

> **Generated** from `src/config/flags.ts` by `npm run gen:flags-doc` — do not edit by hand.
> `src/config/flags.test.ts` fails when this file is stale.

Every flag is parsed by `src/config/flags.ts` (`readFlag`). The grammar is the same for all of them:

- **true** — bare presence (`?flag`, `?flag=`) or `1 | true | on | yes`
- **false** — `0 | false | off | no`
- **unset** — absent, or an unrecognised value (the flag's default applies)
- Values are case-insensitive.

Where a flag also has a persisted `localStorage` choice, precedence is URL → storage → preset/auto-detect.

| Flag | Type | Values | Default | Effect |
|---|---|---|---|---|
| `?renderer` | enum | `auto` \| `webgpu` \| `webgl` | — | Backend preference. WebGL weather is a reference only; boot still probes WebGPU. |
| `?webgl` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | — | Shorthand for `?renderer=webgl`. |
| `?webgpu` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | — | Shorthand for `?renderer=webgpu`. |
| `?gpu` | tokens | comma list: `low`, `low-power`, `high`, `high-performance`, `fallback`, `software`, `compat`, `compatibility`, `features` | — | Adapter selection tokens, e.g. `?gpu=high,compat`. `features` dumps enabled optional features on the backend chip. |
| `?hdr` | tri | `on\|off\|auto` (bool spellings accepted) | `off` | Output-referred HDR canvas (extended tone mapping + rgba16float). `auto` follows the display. |
| `?p3` | tri | `on\|off\|auto` (bool spellings accepted) | `off` | Display-P3 canvas colour space (also colours the cabin overlay). `auto` follows the display. |
| `?weather` | enum | `fragment` \| `compute` | — | Weather post-process pipeline. Wins over the persisted choice and the quality preset. |
| `?quality` | enum | `low` \| `medium` \| `high` \| `ultra` | — | Visual quality preset. Wins over the persisted choice and hardware auto-detection. |
| `?effect` | enum | `all` \| `raw` \| `color` \| `weather` \| `fog` \| `night` \| `lighting` | — | Isolate a single post-process effect (debug). |
| `?debug` | enum | `wireframe` | — | `?debug=wireframe` is an alias for `?wireframe`. |
| `?wireframe` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | `false` | Wireframe overlay (debug). |
| `?legacyTransitions` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | — | Force the legacy CPU-timed panorama transition (on) or the GPU transition (off). |
| `?no_gpu_compute` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | `false` | Kill switch for GPU chores (luma/horizon compute). Weather rendering is unaffected. |
| `?no_clip_distances` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | `false` | Do not request the `clip-distances` device feature (also disables the windshield portal). |
| `?cabin` | enum | `webgl` \| `webgpu` | — | Cabin overlay backend. Default follows the WebGPU probe; `webgl` is the escape hatch. |
| `?portal` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | `true` | Windshield portal. `?portal=off` forces the hole + decal overlay. |
| `?gltfInterior` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | — | Use the authored glTF interior kit. Turning it on persists to localStorage. |
| `?wasmNoise` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | — | WASM-driven noise effect. `off` disables it; unset defers to localStorage, then on. |
| `?wasmParticles` | bool | `1\|true\|on\|yes` / `0\|false\|off\|no` | — | WASM GPU particle field. `off` disables it; unset defers to localStorage, then on. |
