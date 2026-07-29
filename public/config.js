// Runtime configuration for WebGPU StreetView.
//
// This file is served as a plain static asset and is loaded BEFORE the React
// bundle, so changes here take effect immediately without a full rebuild.
//
// HOW TO SUPPLY A KEY (current deploy uses Contabo bundle upload of build/):
// - Preferred for safety: leave empty in git. Bake via REACT_APP_MAPS_API_KEY
//   at `npm run build` time, **or** manually edit the deployed config.js on the
//   server after a bundle deploy (no rebuild needed for runtime changes).
// - For CI-like deploys, extend deploy.py to patch config.js inside the zip
//   using a secret before the POST (see issues #84 + #89).
//
// The key used on https://test.1ink.us and https://go.1ink.us MUST have
// HTTP referrer restrictions that whitelist both origins (plus localhost for dev),
// plus billing + Maps JavaScript + Directions APIs enabled.
//
// See README "Production Deployment", docs/DEPLOY_CHECKLIST.md, and #89.
window.MAPS_API_KEY = "";

// Cesium Ion token for full-screen GlobeView + MiniMap world terrain/imagery
// (optional — without it, both fall back to a flat ellipsoid + free CartoCDN
// tiles). Same runtime-first convention as MAPS_API_KEY above: leave blank in
// git, bake via REACT_APP_CESIUM_ION_TOKEN at build time, deploy via
// CESIUM_ION_TOKEN=... python deploy.py, or edit here after a bundle deploy.
// Get a token at https://ion.cesium.com/tokens.
window.CESIUM_ION_TOKEN = "";

// Supabase project used ONLY as a signaling relay for Shared Exploration
// Sessions (multiplayer road trips) — short room codes instead of pasting
// SDP blobs. The anon/publishable key is safe to expose client-side (that's
// what it's for), but following the same convention as MAPS_API_KEY above,
// this stays blank in git and is supplied via REACT_APP_SUPABASE_URL /
// REACT_APP_SUPABASE_ANON_KEY at build time, or edited here after a bundle
// deploy. No Street View imagery ever touches this channel — see
// src/hooks/useSharedSession.ts and README "Shared Exploration Sessions".
window.SUPABASE_URL = "";
window.SUPABASE_ANON_KEY = "";
