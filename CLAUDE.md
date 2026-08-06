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
- **Shader uniform layout** — `src/renderer/weatherUniformLayout.ts` must match both weather WGSL passes.

## Commands

```bash
npm ci          # clean install
npm start       # dev server :3000
npm test        # Vitest
npm run typecheck
npm run lint
npm run build
```

_Last updated: foundation refactor (#173 superseded)._
