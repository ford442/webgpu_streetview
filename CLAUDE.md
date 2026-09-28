# Claude quick reference

**Source of truth:** [`AGENTS.md`](./AGENTS.md) — architecture, danger zones, build/test/deploy, and agent workflows.

This file is a short pointer so Claude Code sessions land on the right doc without duplicating content.

## Start here

1. Read `AGENTS.md` (project map, hotspots, testing strategy).
2. For human-facing setup: `README.md`.
3. For deep graphics pipeline: `docs/DEVELOPER_CONTEXT.md`, `docs/RENDERER_FALLBACK.md`.
4. For billable APIs (rearview Static feed): `BILLING_SAFETY_CHECKLIST.md`.

## Critical danger zones (do not skip)

- **Canvas scraping** (`src/components/StreetView.tsx`) — opacity must stay `1`; recovery is continuous.
- **Hold-pause** (`Renderer.ts`, `WebGPUCanvas.tsx`, `useStreetView.tsx`) — never upload live GMaps canvas while `holdActive`; use `window.__STREETVIEW_PROBE__`.
- **Input hijacking** — UI overlays must `stopPropagation` on mouse/keyboard events.
- **Maps API keys** — runtime `public/config.js` / deploy `MAPS_API_KEY`; referrer allowlist per host.
- **Shader uniform layout** — `src/renderer/weatherUniformLayout.ts` must match both weather WGSL passes. Shader *variants* (subgroups, dual-source precip, the `?hdr` output-referred grade) are source substitutions at pipeline-create time in `shaderFeatureVariants.ts` — keep their literal bodies byte-identical to the shipped `.wgsl`.
- **One-frame compositor** — the default WebGPU cabin renders into a `GPUTexture` (`car/interior/cabinFrameTarget.ts`) that `renderer/cabinComposite.ts` draws over the swap chain. `renderer/cabinOverlayRegistry.ts` must stay a single module instance across chunks; cinema/snapshots skip the 2D latch only when `isCabinCompositedInFrame()` is true.
- **Windshield portal** — the WebGPU cabin's wet glass (`WindowWeatherOverlay` → `WindshieldPortal`) samples the road's pass-1 HDR intermediate through `renderer/roadFrameRegistry.ts` (single module instance; intermediate only — never the Maps canvas, `videoTexture`, or the rear feed). The road owns that texture: `car/interior/roadFrameBinding.ts` must keep `neuterDestroy` and a new `ExternalTexture` wrapper per texture identity. `createRoadDisplay` mirrors `weather-post`'s look — change `fs_main`'s colour path and update it (`windshieldPortal.parity.test.ts`, `e2e/windshield-portal.spec.ts`). Gated on `clip-distances`; `?portal=off` / `?no_clip_distances` / `?cabin=webgl` fall back to hole + decal.
- **WASM numeric layer** — algorithms live in `cpp/src/*_module.cpp` (one translation unit per domain: noise, geodesy, audio, hrtf, luma) and ship via emcc (`npm run build:wasm`). Changing the C++ means regenerating `cpp/tests/goldens*` (`npm run gen:wasm-goldens`) and re-running `npm run test:cpp`. A new `.cpp` must be added to both CMake source lists, `scripts/lint-cpp.sh` and `scripts/wasm-source-hash.mjs`.

## Commands

```bash
npm ci          # clean install
npm start       # dev server :3000
npm test        # Vitest
npm run typecheck
npm run lint
npm run build
npm run test:cpp  # native C++ golden tests (needs cmake + a C++20 compiler)
```

_Last updated: windshield portal (#273 slice 2)._
