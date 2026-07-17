# 🛡️ Billing Safety Checklist - Quick Reference

**Use this checklist EVERY TIME you work with Google Cloud APIs.**

---

## Before Enabling Any API

- [ ] Project created specifically for this application (not personal account)
- [ ] Billing account linked with notifications enabled
- [ ] Budget alerts configured at: $10, $25, $50, $100
- [ ] Cost Management → "Prevent overspend" enabled

---

## When Creating API Keys

- [ ] API key created in Google Cloud Console
- [ ] **IMMEDIATELY set HTTP referrer restrictions** (do NOT skip!)
  - Development: `localhost:3000/*`, `localhost:3001/*`, etc.
  - Production: Your actual domain only
- [ ] API-specific restrictions applied (Maps JS, not all APIs)
- [ ] Key labeled with purpose: `app-name-env-domain`
- [ ] Key added to `.env.local` or passed via `MAPS_API_KEY=... python deploy.py` (NOT hardcoded in source)
- [ ] `.env.local` file is in `.gitignore` (don't commit)

---

## When Deploying

- [ ] `DEPLOY_TOKEN` exported from secure storage (never committed to git)
- [ ] `./scripts/check-deploy-secrets.sh` passes (no hardcoded deploy credentials in repo)
- [ ] Production Maps key passed via `MAPS_API_KEY` env var or GitHub Actions secret
- [ ] See `docs/DEPLOY_CHECKLIST.md` for full pre/post deploy steps

---

## After Deploying

- [ ] Check billing daily for first week
- [ ] Review API usage logs weekly
- [ ] Verify website restrictions still in place
- [ ] Test that requests from wrong domain are rejected
- [ ] Confirm all API keys have restrictions (no exceptions!)

---

## Monthly Maintenance

- [ ] Review Google Cloud billing dashboard
- [ ] Check all enabled APIs (disable unused ones)
- [ ] Verify all API keys have restrictions
- [ ] Test budget alerts are working
- [ ] Document any cost changes

---

## Emergency (Unexpected Costs)

**DO THIS IMMEDIATELY** (within 5 minutes):

1. Go to **APIs & Services → Credentials**
2. Find the exposed API key
3. Click **"Delete"** (or **"Disable"**)
4. Go to **Cloud Logging** → search for unusual requests
5. Contact Google Cloud Support → request cost review

---

## Red Flags (Stop & Investigate)

🚨 **If you see ANY of these, take action immediately**:

- [ ] API key works without HTTP restrictions
- [ ] API key not mentioned in documentation
- [ ] Multiple API keys with overlapping restrictions
- [ ] Billing alert triggered without explanation
- [ ] Requests from IP addresses you don't recognize
- [ ] API usage spike with no code changes
- [ ] Same key used in development and production
- [ ] API key in git history
- [ ] `DEPLOY_TOKEN` or SFTP password committed to Python/shell deploy scripts
- [ ] `deploy_old.py` present in the repository

---

## Reference Files

📄 **Read these before deploying**:
- [`docs/DEPLOY_CHECKLIST.md`](./docs/DEPLOY_CHECKLIST.md) - Production deploy + credential hygiene
- [`.env.deploy.example`](./.env.deploy.example) - Required deploy environment variables
- [`BILLING_WARNINGS.md`](./BILLING_WARNINGS.md) - Full incident report
- [`docs/GOOGLE_CLOUD_API_SETUP_GUIDE.md`](./docs/GOOGLE_CLOUD_API_SETUP_GUIDE.md) - Complete setup steps
- [`CLAUDE.md`](./CLAUDE.md) - Maps key recovery behaviors

---

## One-Page Summary

| Task | What to Do | Why |
|------|-----------|-----|
| **Before API** | Create separate GCP project | Isolate risk |
| **Create Key** | Set HTTP referrer restrictions | Prevent unauthorized use |
| **Develop** | Use `.env` file, not hardcoded values | Avoid committing secrets |
| **Monitor** | Check billing weekly | Catch anomalies early |
| **Rotate** | New key every 90 days | Limit exposure window |
| **Incident** | Delete key immediately | Stop unauthorized charges |

---

**Remember**: A few minutes of setup now saves you $300-800+ in unexpected charges later.

**When in doubt, check `BILLING_WARNINGS.md` or `GOOGLE_CLOUD_API_SETUP_GUIDE.md`.**
