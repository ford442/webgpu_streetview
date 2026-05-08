# ⚠️ BILLING WARNINGS - Google Cloud API Management

## Critical Issue: Unexpected $300-800 Overnight Charges

**Status**: This project has experienced unexpected Google Cloud billing charges (2026-05-08) from enabling multiple APIs without proper safeguards. This document exists to prevent similar incidents in the future.

### What Happened

- Multiple Google Cloud APIs were enabled on the same project
- API keys were created without **HTTP Referrer restrictions** (aka "Website restrictions")
- Within hours, unauthorized or misconfigured requests incurred significant costs
- The breach was not discovered until the cost was already substantial

### Root Cause Analysis

1. **No Website Restrictions**: API keys were globally accessible, allowing anyone to use them
2. **Multiple Enabled APIs**: Each API can be exploited independently
3. **No Cost Alerts**: Budget notifications were not configured
4. **No API Usage Monitoring**: Changes went unnoticed until billing review

---

## Prevention Checklist

### 🔴 BEFORE Enabling Any Google Cloud API

- [ ] **Create a new GCP Project** - Do NOT use personal/shared projects for public applications
- [ ] **Set up billing alerts** - Configure budget notifications at $10, $25, $50, etc.
- [ ] **Enable cost monitoring** - Use GCP Cost Management dashboard
- [ ] **Plan API costs** - Review pricing for each API you need
- [ ] **Use separate API keys** for different purposes (public vs. backend)

### 🔴 WHEN Creating API Keys

- [ ] **Set HTTP Referrer restrictions** - Restrict to your domain(s) only
  - Go to: **APIs & Services → Credentials → Select Key → Application Restrictions → HTTP referrers**
  - Example: `localhost:3000/*`, `yourdomain.com/*`
- [ ] **Rotate keys regularly** - Every 90 days minimum
- [ ] **Enable API-specific quotas** - Limit requests per day/hour if possible
- [ ] **Document restrictions** - Record which key is for which service
- [ ] **Never commit API keys** to version control - Use `.env` files

### 🔴 AFTER Deploying to Production

- [ ] **Monitor daily costs** - Set up email alerts for cost spikes
- [ ] **Review API usage logs** - Check for unusual patterns
- [ ] **Audit all enabled APIs** - Disable unused ones immediately
- [ ] **Implement request rate limiting** on your backend
- [ ] **Consider using Cloud Endpoints** for API management and protection

---

## For This Project (WebGPU StreetView)

### Current Setup Issues

The project currently uses:
- **Google Maps JavaScript API** (required for Street View)
- **Google Maps Directions API** (for route planning)
- **API Key**: Hardcoded in `src/App.tsx` (security issue)

### Required Changes

1. **Environment Variables**
   ```bash
   # .env (NOT COMMITTED)
   REACT_APP_MAPS_API_KEY=your_key_here
   REACT_APP_MAPS_DIRECTIONS_KEY=your_key_here
   ```

2. **Create Multiple API Keys** in GCP:
   - **Key 1 (Street View)**: Restrict to `localhost:3000/*` for development
   - **Key 2 (Directions)**: Same restrictions
   - **Key 3 (Production)**: Restrict to your production domain only

3. **Website Restrictions Setup**
   ```
   Go to: Google Cloud Console
   → APIs & Services
   → Credentials
   → Click on your API key
   → Application Restrictions
   → Select "HTTP referrers (websites)"
   → Add: localhost:3000/*, https://yourdomain.com/*
   ```

4. **Update CLAUDE.md**
   - Move hardcoded API key warning to required section
   - Document `.env` setup process
   - Link to this billing warnings document

---

## Emergency Response

### If You Notice Unexpected Charges

1. **Immediately disable the API key** in Google Cloud Console
   - Go to: **APIs & Services → Credentials**
   - Click the key → **Disable**

2. **Review usage logs**
   - Go to: **Logs Router** or **Cloud Logging**
   - Search for unusual requests from unknown IPs

3. **Check enabled APIs**
   - Go to: **APIs & Services → Enabled APIs & Services**
   - Disable any APIs not actively used

4. **Contact Google Cloud Support**
   - Request review of charges for potential refund
   - Explain the API key exposure
   - Ask about credit reversal

5. **Rotate all API keys**
   - Delete exposed keys
   - Create new keys with proper restrictions
   - Update all applications

---

## Monitoring & Maintenance

### Monthly Tasks

- [ ] Review GCP **Billing Dashboard** for cost trends
- [ ] Check **API usage** for each enabled API
- [ ] Verify all API keys have **website restrictions**
- [ ] Confirm **budget alerts** are still configured
- [ ] Audit **API permissions** used by application

### Quarterly Tasks

- [ ] Rotate all API keys (create new, delete old)
- [ ] Review enabled APIs - disable unused ones
- [ ] Update documentation with current API key restrictions
- [ ] Test that rate limiting / quotas are enforced

---

## Resources

- [Google Cloud API Security Best Practices](https://cloud.google.com/docs/authentication/application-default-credentials)
- [API Key Restrictions](https://cloud.google.com/docs/authentication/api-keys#api_key_restrictions)
- [GCP Billing Alerts](https://cloud.google.com/billing/docs/how-to/budgets)
- [Cloud Logging for API Usage](https://cloud.google.com/logging/docs)

---

## Future Notes

As more information becomes available about what specifically triggered the charges, updates will be added below.

**Date**: 2026-05-08
**Next Review**: 2026-05-15 (when issue investigation completes)

---

**IMPORTANT**: Do not proceed with deploying this application to production until API keys are properly restricted and billing alerts are configured.
