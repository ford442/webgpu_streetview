# Google Cloud API Setup & Security Guide

## Overview

This guide provides step-by-step instructions for safely setting up Google Cloud APIs for the WebGPU StreetView project, with special emphasis on preventing unexpected billing charges.

---

## Part 1: GCP Project Setup

### Step 1: Create a New GCP Project (Recommended)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click the project dropdown at the top
3. Click **"New Project"**
4. Name: `webgpu-streetview` or `webgpu-streetview-dev`
5. Click **"Create"**

> **Why separate projects?** If this project's API key is compromised, only this project's budget is at risk, not your personal/business GCP account.

### Step 2: Set Up Billing & Alerts

1. **Enable Billing**:
   - Go to: **Billing** (left sidebar)
   - Click **"Link Billing Account"**
   - Select an existing billing account or create a new one
   - Confirm

2. **Create Budget Alerts**:
   - Go to: **Billing → Budgets & Alerts**
   - Click **"Create Budget"**
   - Set budget name: `webgpu-streetview-budget`
   - Set limit: `$50` (or your chosen limit)
   - Set up notifications at: 50%, 90%, 100%, 110%
   - Save

3. **Enable Cost Management**:
   - Go to: **Billing → Cost Management → Cost Control**
   - Enable **"Prevent overspend"** (blocks requests when budget exceeded)

---

## Part 2: Enable Required APIs

### For Street View & Navigation

**Required APIs**:
1. Maps JavaScript API
2. Maps Directions API

**Enable them**:
1. Go to: **APIs & Services → Enabled APIs & Services**
2. Click **"+ Enable APIs and Services"**
3. Search for **"Maps JavaScript API"**
4. Click **"Enable"**
5. Repeat for **"Maps Directions API"**

**Verify**:
- You should see both APIs in your **Enabled APIs & Services** list
- Check the **Library** tab if you need to find other APIs

---

## Part 3: Create & Restrict API Keys

### Step 1: Create API Key for Development

1. Go to: **APIs & Services → Credentials**
2. Click **"+ Create Credentials"** → **"API Key"**
3. A dialog shows your new API key
4. Click **"Restrict Key"** (do this immediately!)

### Step 2: Set API Restrictions

1. On the **Restrict Key** page:
2. Under **"API Restrictions"**:
   - Select **"Restrict key"**
   - Check: **Maps JavaScript API**
   - Check: **Maps Directions API**
   - (Uncheck any others)
3. Click **"Save"**

> **Why?** Restricting APIs prevents unauthorized use of unrelated GCP services.

### Step 3: Set Website Restrictions (CRITICAL!)

1. On the same **Restrict Key** page:
2. Under **"Application Restrictions"**:
   - Select **"HTTP referrers (websites)"**
   - In the text field, add **every host you will ever deploy the demo to** (the live demo uses two):
     ```
     https://test.1ink.us/*
     https://go.1ink.us/*
     http://localhost:3000/*
     http://localhost:3001/*
     ```
3. Click **"Save"**

> **Why?** The most common cause of the "This page can't load Google Maps correctly" error on the live demo is forgetting to add the `test.1ink.us` (or `go.1ink.us`) pattern. The same key works on one host but fails on the other when restrictions are incomplete. Use the runtime `config.js` + `deploy.py` mechanism for production so you can rotate keys without rebuilding.

### Step 4: Label Your Key

1. Copy the key value
2. Rename it to: `webgpu-streetview-dev-localhost`
3. This makes it clear what the key is for

---

## Part 4: Create Production API Key (for test.1ink.us / go.1ink.us)

### When Deploying to Production

1. Repeat **Part 3** (or edit an existing key) and add **both** live hosts:
   ```
   https://test.1ink.us/*
   https://go.1ink.us/*
   ```
2. Label it clearly: `webgpu-streetview-prod-2026`
3. **Use the runtime injection path** for deploys:
   ```bash
   MAPS_API_KEY="the-new-prod-key" python deploy.py
   ```
   This writes `public/config.js` (actually `build/config.js`) at deploy time so the key never lives in the git history or a baked bundle for the wrong host.

> **Important**: Keep production and development keys separate! The #72 "can't load Google Maps correctly" bug was caused by a key restricted only for `go.1ink.us` being served to `test.1ink.us` visitors.

---

## Part 5: Local Development Setup

### Step 1: Create `.env` File

In the project root (`/home/user/webgpu_streetview/`), create a file named `.env`:

```bash
# Development API Keys
REACT_APP_MAPS_API_KEY=AIzaSy...your_development_key_here...
REACT_APP_MAPS_DIRECTIONS_KEY=AIzaSy...your_development_key_here...

# Note: These files should NOT be committed to git
```

> **Security**: `.env` is already in `.gitignore`, so it won't be committed.

### Step 2: Update App.tsx

Replace the hardcoded API key with environment variable:

```typescript
// Before (hardcoded - INSECURE):
const API_KEY = 'AIzaSy...hardcoded...';

// After (uses environment variable):
const API_KEY = process.env.REACT_APP_MAPS_API_KEY || '';
if (!API_KEY) {
  console.error('Missing REACT_APP_MAPS_API_KEY in .env file');
}
```

### Step 3: Run Development Server

```bash
npm start
# The API key from .env will be available at process.env.REACT_APP_MAPS_API_KEY
```

---

## Part 6: Quota & Rate Limiting

### Set API Quotas

1. Go to: **APIs & Services → Quotas**
2. Find **"Maps JavaScript API"**
3. Click on it
4. Set limits based on expected usage:
   - **Requests per day**: 1,000 (adjust as needed)
   - **Requests per minute**: 100
5. Click **"Edit Quota"** and save

### Rate Limiting in Your Code

Add request throttling in your application:

```typescript
// Example: Limit Street View pans to 1 per second
const MIN_PAN_INTERVAL = 1000; // milliseconds
let lastPanTime = 0;

function handlePan(direction: string) {
  const now = Date.now();
  if (now - lastPanTime < MIN_PAN_INTERVAL) {
    return; // Skip if too soon
  }
  lastPanTime = now;
  // ... perform pan operation ...
}
```

---

## Part 7: Monitoring & Cost Control

### Daily Monitoring

1. Go to: **Billing → Overview**
2. Check:
   - Current month's costs (should be near $0 for idle projects)
   - Which APIs are generating costs
   - Any unexpected spikes

### Monthly Review

1. Go to: **APIs & Services → Credentials**
2. Verify all API keys still have restrictions
3. Check for any unused/disabled projects
4. Disable any APIs no longer in use

### Cost Anomaly Detection

1. Go to: **Billing → Cost Management → Cost Anomaly Alerts**
2. Enable automatic alerts for unusual spending patterns
3. Google will email you if costs spike unexpectedly

---

## Part 8: Emergency Response Procedures

### If You See Unexpected Charges

**Immediate Actions (Next 5 Minutes)**:
1. Go to: **APIs & Services → Credentials**
2. Find the exposed API key
3. Click **"Delete"** (or temporarily **"Disable"**)
4. This stops all requests using that key immediately

**Investigation (Next Hour)**:
1. Go to: **Logs → Cloud Logging**
2. Search for requests using the compromised key:
   ```
   resource.type="api"
   labels.service_name="maps.googleapis.com"
   severity="NOTICE"
   ```
3. Check for:
   - Unusual IP addresses
   - Geographic anomalies (e.g., requests from countries you don't operate in)
   - Abnormal request patterns

**Recovery (Same Day)**:
1. Contact Google Cloud Support (requires paid support plan, or billing support)
2. Provide evidence of the anomaly
3. Request review for potential refund
4. Ask about credit reversal due to API key exposure

---

## Part 9: Production Deployment Checklist

Before deploying to production:

- [ ] Create separate API keys for production
- [ ] Set **HTTP referrer restrictions** to your production domain
- [ ] Update `.env` file (or CI/CD secrets) with production keys
- [ ] Test that API calls work from your production domain
- [ ] Configure billing alerts for production project
- [ ] Enable **"Prevent overspend"** in Cost Management
- [ ] Document all API keys and their restrictions
- [ ] Set up monthly cost review process
- [ ] Test API key rotation procedure

---

## Part 9a: Cesium Ion Token (Optional, for World Terrain)

Separate from Google Maps, Globe View / MiniMap optionally use a [Cesium Ion](https://ion.cesium.com/tokens) token for real world terrain + satellite imagery instead of the free flat-ellipsoid + CartoCDN fallback.

1. Sign up at https://ion.cesium.com/tokens (free tier covers world terrain + imagery).
2. Create a token; optionally restrict it to your production domain(s) under token settings.
3. Provide it the same two ways as `MAPS_API_KEY`:
   - **Runtime (preferred)**: `CESIUM_ION_TOKEN=... python deploy.py` bakes it into the deployed bundle, no rebuild needed.
   - **Build-time**: `REACT_APP_CESIUM_ION_TOKEN=...` in `.env.local` for local dev.
4. This token is optional — omitting it just means Globe View renders a flat ellipsoid, it does not block Street View or any Google Maps feature.

See the README's "Cesium Ion World Terrain (Optional)" section for the full setup + verification steps.

---

## Part 10: Key Rotation (Quarterly)

### Schedule: Every 90 Days

1. **Create new key** (follow Part 3 steps 1-3)
2. **Update application** with new key
3. **Deploy to production**
4. **Wait 24 hours** (ensure new key works)
5. **Delete old key** from GCP Console
6. **Update documentation** with new key date

### Keep a Rotation Log

```
Date       | Service  | Old Key Suffix | New Key Suffix | Status
-----------|----------|----------------|----------------|----------
2026-05-15 | Street View | ...abc123  | ...def456     | Rotated
2026-08-15 | Street View | ...def456  | ...ghi789     | Rotated
```

---

## FAQ

**Q: Will my API key work if I don't set HTTP restrictions?**
A: Yes, but anyone on the internet can use it, which could incur unlimited costs.

**Q: Can I use the same API key for development and production?**
A: Not recommended. Use separate keys with different restrictions.

**Q: What if I forget my API key restriction?**
A: You can regenerate a new key. The old one becomes useless.

**Q: How often should I check my billing?**
A: Daily during development, weekly in production. Monthly minimum.

**Q: What if costs suddenly spike?**
A: Immediately disable the API key, check logs for anomalies, and contact support.

---

## Related Documents

- [`BILLING_WARNINGS.md`](../BILLING_WARNINGS.md) - Critical billing incident documentation
- [Google Cloud API Security](https://cloud.google.com/docs/authentication)
- [Maps JavaScript API Documentation](https://developers.google.com/maps/documentation/javascript)
- [GCP Billing Documentation](https://cloud.google.com/billing/docs)

---

**Last Updated**: 2026-05-08
**For Questions**: Refer to BILLING_WARNINGS.md or Google Cloud Support
