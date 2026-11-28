# v1.0.0 — Draft release notes

> Draft only. Publish as the GitHub Release after the release gates in
> [`RELEASING.md`](./RELEASING.md) pass and production is verified against the
> release tag.

## Highlights

- Linked WESL shader sources and validated WGSL variants for the WebGPU render
  pipeline.
- A simulated vehicle model for cabin driving, with engine, transmission, and
  handling telemetry.
- Physically based atmosphere rendering, semantic scene effects, and temporal
  resolve for improved weather and image quality.
- A WebXR cockpit, offline road-trip planning and replay, and a redesigned
  cabin look.

## Requirements and known limitations

- Street View rendering requires a browser and GPU with WebGPU support. Chrome
  or Edge on a supported desktop or Android device is recommended. Browser,
  operating-system, and GPU support varies; without WebGPU the app displays its
  documented unavailable/fallback UI rather than the WebGPU renderer.
- Google Maps requires a valid, billed Maps key whose HTTP-referrer allowlist
  includes the host being used. An invalid key may still show Google's own
  error overlay instead of the app's authentication banner; see the known
  defect in [`PRODUCTION_SMOKE.md`](./PRODUCTION_SMOKE.md).
- Depth, semantic effects, and some renderer features are optional and depend
  on model downloads and GPU capability. Offline mode stores app data and
  trip metadata, not Google Maps imagery.

## URL flags

See the generated [URL flags reference](./FLAGS.md) for supported flags and
their values.

## Billing and external services

- Google Maps usage is subject to Google Maps Platform billing and quotas.
  Search, panorama lookup, and navigation calls are metered by the app; do not
  assume browsing is free.
- The rear-view Street View Static feed is opt-in and billable per request.
- Routed trips use the configured OSRM-compatible routing service. The public
  demo endpoint is for low-volume use only.
- Review [`BILLING_SAFETY_CHECKLIST.md`](../BILLING_SAFETY_CHECKLIST.md)
  before enabling or testing billable features.
