# EDGEnyc Performance Tracking

This repo tracks performance over time for:
- https://edgenyc.com/
- https://edgenyc.com/get-tickets

## What runs
- **Daily Lighthouse (lab)**: appends rows to `data/edgenyc-daily.csv`
- **Weekly PSI field snapshot (RUM)**: appends rows to `data/edgenyc-psi-weekly.csv`

GitHub Actions schedules are in `.github/workflows/`.

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
