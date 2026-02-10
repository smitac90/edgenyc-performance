# EDGEnyc Performance Tracking

This repo tracks performance over time for:
- https://edgenyc.com/
- https://edgenyc.com/get-tickets

## What runs
- **Daily Lighthouse (lab)**: appends rows to `data/edgenyc-daily.csv` (mobile + desktop).
- **Daily alerts**: checks the latest run against thresholds and opens an issue if breached.
- **Daily GSC export**: appends rows to `data/edgenyc-gsc-pages-daily.csv` and `data/edgenyc-gsc-queries-daily.csv`.
- **Weekly PSI field snapshot (RUM)**: appends rows to `data/edgenyc-psi-weekly.csv`.
- **Weekly summary**: writes `reports/weekly-summary.md` with last 7 days averages + deltas.
- **Weekly SEO summary**: writes `reports/seo-summary.md` combining GSC + Semrush top pages.
- **Semrush pages import (manual)**: appends rows to `data/edgenyc-semrush-pages.csv`.

Schedules live in `.github/workflows/`.

## Config
Edit `config/edgenyc.json` to:
- Add/remove URLs
- Tune Lighthouse strategies
- Control how many Lighthouse runs are averaged (`lighthouse_runs`)
- Update alert thresholds
- Configure GSC export (site_url, lag, row limits)

## Local usage
Install deps:
```bash
npm install
```

Run daily Lighthouse (writes to `data/` by default):
```bash
node scripts/edgenyc-perf.mjs
```

Run daily GSC export:
```bash
export GSC_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
node scripts/edgenyc-gsc-daily.mjs
```

Run weekly PSI snapshot:
```bash
export PSI_API_KEY="YOUR_API_KEY"
node scripts/edgenyc-psi-weekly.mjs
```

Generate weekly performance summary:
```bash
node scripts/edgenyc-weekly-summary.mjs
```

Generate weekly SEO summary:
```bash
node scripts/edgenyc-seo-summary.mjs
```

Check alerts:
```bash
node scripts/edgenyc-alerts.mjs
```

### Semrush Top Pages import (manual)
1. Export CSV from Semrush **Organic Research → Top Pages**.
2. Drop the CSV in `data/incoming/`.
3. Run:
```bash
node scripts/edgenyc-semrush-import-pages.mjs
```

### Sync results to Box (hybrid mode)
This pulls the latest repo data and copies CSVs + reports into your Box folder.
```bash
node scripts/sync-to-box.mjs
```

You can override the Box path with:
```bash
export BOX_DIR="/Users/andysmith/Library/CloudStorage/Box-Box/Andy's Box Drive/Codex Automations/Lighthouse Reports"
node scripts/sync-to-box.mjs
```

### Save to Box instead of repo
Set `OUT_DIR` to your Box folder when running locally:
```bash
export OUT_DIR="/Users/andysmith/Library/CloudStorage/Box-Box/Andy's Box Drive/Codex Automations/Lighthouse Reports"
node scripts/edgenyc-perf.mjs
```

## GSC setup (service account)
1. Enable the **Google Search Console API** in your Google Cloud project.
2. Create a **service account** and download the JSON key.
3. Add the service account email as an **owner** on your Search Console property.
4. Add the JSON as a GitHub secret: `GSC_SERVICE_ACCOUNT_JSON`.

Notes:
- `gsc.site_url` must match your Search Console property URL exactly (including trailing slash for URL-prefix properties).
- GSC Search Analytics dates are interpreted in Pacific Time.

## GitHub Secrets
Set these secrets in GitHub:
- `PSI_API_KEY`
- `GSC_SERVICE_ACCOUNT_JSON`

## Schedule (UTC)
- Daily Lighthouse: 13:00 UTC (approx 8:00 AM ET)
- Daily GSC: 14:30 UTC (approx 9:30 AM ET)
- Weekly PSI: Mondays 13:30 UTC (approx 8:30 AM ET)
- Weekly performance summary: Mondays 14:00 UTC (approx 9:00 AM ET)
- Weekly SEO summary: Mondays 14:00 UTC (approx 9:00 AM ET)
