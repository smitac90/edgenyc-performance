# EDGEnyc Performance Tracking

This repo tracks performance over time for:
- https://edgenyc.com/
- https://edgenyc.com/get-tickets

## What runs
- **Daily Lighthouse (lab)**: appends rows to `data/edgenyc-daily.csv` (mobile + desktop).
- **Daily alerts**: checks the latest run against thresholds and opens an issue if breached.
- **Weekly PSI field snapshot (RUM)**: appends rows to `data/edgenyc-psi-weekly.csv`.
- **Weekly summary**: writes `reports/weekly-summary.md` with last 7 days averages + deltas.

Schedules live in `.github/workflows/`.

## Config
Edit `config/edgenyc.json` to:
- Add/remove URLs
- Tune Lighthouse strategies
- Update alert thresholds

## Local usage
Install deps:
```bash
npm install
```

Run daily Lighthouse (writes to `data/` by default):
```bash
node scripts/edgenyc-perf.mjs
```

Run weekly PSI snapshot:
```bash
export PSI_API_KEY="YOUR_API_KEY"
node scripts/edgenyc-psi-weekly.mjs
```

Generate weekly summary:
```bash
node scripts/edgenyc-weekly-summary.mjs
```

Check alerts:
```bash
node scripts/edgenyc-alerts.mjs
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

## GitHub Secrets
Set this secret in GitHub:
- `PSI_API_KEY`

## Schedule (UTC)
- Daily Lighthouse: 13:00 UTC (approx 8:00 AM ET)
- Weekly PSI: Mondays 13:30 UTC (approx 8:30 AM ET)
- Weekly summary: Mondays 14:00 UTC (approx 9:00 AM ET)
