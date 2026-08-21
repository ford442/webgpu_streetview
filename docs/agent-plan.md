# Agent implementation plan (archived)

The historical feature log lives in **[docs/archive/agent-plan.md](./archive/agent-plan.md)**. It describes a pre-#171 rearview (forward-canvas UV crop) and `App.tsx` as mediator — that is not the live contract.

For current architecture and danger zones, use **[AGENTS.md](../AGENTS.md)**. Rearview: `src/car/RearviewMirror.ts` + billing-gated `src/car/rearViewFeed.ts`. Active residuals: **[weekly_plan.md](../weekly_plan.md)**.
