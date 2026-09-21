# Graphics & Rendering Pipeline — moved

This file is a stub. The graphics SSOT now lives in two places:

| Topic | Read |
|---|---|
| Weather & atmosphere look targets, preset intent, CPU cohesion model, view-depth proxy, cinematic camera FX gate | [`docs/GRAPHICS.md`](../../docs/GRAPHICS.md) |
| Renderer architecture, device policy, cabin backend, danger zones | [`AGENTS.md`](../../AGENTS.md) → *Car Mode Rendering Stack* |
| Fallback chain and backend selection | [`docs/RENDERER_FALLBACK.md`](../../docs/RENDERER_FALLBACK.md) |
| Deeper pipeline notes | [`docs/DEVELOPER_CONTEXT.md`](../../docs/DEVELOPER_CONTEXT.md) |

## Why this was stubbed

The old copy described a **Three.js WebGL overlay** as the production cabin
path. That has not been true since the #249 split: the default is
`THREE.WebGPURenderer({ device })` on the single shared `GPUDevice` handed out
by `Renderer.getSharedGpuDevice()` (still the only `requestDevice` call site).
`?cabin=webgl` is an escape hatch, not the default. The composite is still
**two canvases** — panorama and cabin — until the one-frame compositor lands
(#273).

Rather than maintain a second, drifting description of the pipeline, this file
now points at the documents that are kept current.
