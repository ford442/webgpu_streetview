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
