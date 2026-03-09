#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const configPath = process.env.CONFIG_PATH || "config/edgenyc.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const thresholds = config.psi_thresholds || config.cwv_thresholds || {};

const dataFile = process.env.CWV_CSV || "data/edgenyc-cwv-daily.csv";
const outFile = process.env.CWV_ALERTS_OUT || "reports/cwv-alerts.md";

mkdirSync("reports", { recursive: true });

function noData(msg = "No data available.") {
  writeFileSync(outFile, `# CWV Field Alerts\n\n${msg}\n`, "utf8");
  console.log(msg);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "has_cwv_alerts=false\n");
  process.exit(0);
}

if (!existsSync(dataFile)) noData("No CWV data file found.");

const raw = readFileSync(dataFile, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);
if (lines.length < 4) noData();

const columns = lines[2].split(",");
const dataLines = lines.slice(3);

function parseRow(line) {
  const parts = line.split(",");
  return Object.fromEntries(columns.map((col, i) => [col, parts[i] ?? ""]));
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Google CWV 3-tier thresholds: Good / Needs Improvement / Poor
// "good" boundary is configurable via psi_thresholds; "poor" boundary is Google's fixed value.
const cwvSpec = {
  lcp_p75_ms:  { label: "LCP",  good: thresholds.lcp_p75_ms  ?? 2500, poor: 4000,  unit: "ms" },
  cls_p75:     { label: "CLS",  good: thresholds.cls_p75     ?? 0.1,  poor: 0.25,  unit: "" },
  inp_p75_ms:  { label: "INP",  good: thresholds.inp_p75_ms  ?? 200,  poor: 500,   unit: "ms" },
  ttfb_p75_ms: { label: "TTFB", good: thresholds.ttfb_p75_ms ?? 800,  poor: 1800,  unit: "ms" },
};

function classify(metric, value) {
  const spec = cwvSpec[metric];
  if (!spec || value === null) return null;
  if (value <= spec.good) return "Good";
  if (value <= spec.poor) return "Needs Improvement";
  return "Poor";
}

function fmtValue(metric, value) {
  if (value === null) return "n/a";
  const spec = cwvSpec[metric];
  const raw = metric === "cls_p75" ? value.toFixed(3) : Math.round(value).toString();
  return spec?.unit ? `${raw}${spec.unit}` : raw;
}

const rows = dataLines.map(parseRow).filter((r) => r.timestamp_iso && r.url);

// Latest row per URL
const latestByUrl = new Map();
for (const row of rows) {
  const existing = latestByUrl.get(row.url);
  if (!existing || new Date(row.timestamp_iso) > new Date(existing.timestamp_iso)) {
    latestByUrl.set(row.url, row);
  }
}

const STATUS_ICON = { Good: "✅", "Needs Improvement": "⚠️", Poor: "❌" };

const pageStatuses = [];
const allAlerts = [];

for (const row of latestByUrl.values()) {
  const pageAlerts = [];
  const metricStatuses = {};

  for (const metric of Object.keys(cwvSpec)) {
    const value = toNumber(row[metric]);
    const status = classify(metric, value);
    metricStatuses[metric] = { value, status };
    if (status === "Needs Improvement" || status === "Poor") {
      pageAlerts.push({ metric, value, status });
    }
  }

  pageStatuses.push({ url: row.url, scope: row.field_scope || "n/a", metricStatuses, pageAlerts });
  if (pageAlerts.length) allAlerts.push(...pageAlerts.map((a) => ({ ...a, url: row.url })));
}

const runDate = [...latestByUrl.values()][0]?.timestamp_iso?.slice(0, 10) ?? "unknown";

let md = "# CWV Field Alerts\n\n";
md += `Data: CrUX p75 field measurements (real users). Latest snapshot: ${runDate}\n\n`;
md += "Thresholds follow [Google's Core Web Vitals standards](https://web.dev/vitals/).\n\n";

md += "## Status by Page\n\n";
md += "| Page | Scope | LCP | CLS | INP | TTFB |\n";
md += "| --- | --- | --- | --- | --- | --- |\n";

for (const { url, scope, metricStatuses } of pageStatuses) {
  const cell = (metric) => {
    const { value, status } = metricStatuses[metric];
    if (status === null) return "n/a";
    return `${fmtValue(metric, value)} ${STATUS_ICON[status]}`;
  };
  md += `| ${url} | ${scope} | ${cell("lcp_p75_ms")} | ${cell("cls_p75")} | ${cell("inp_p75_ms")} | ${cell("ttfb_p75_ms")} |\n`;
}

md += "\n**Key:** ✅ Good &nbsp; ⚠️ Needs Improvement &nbsp; ❌ Poor\n";

if (allAlerts.length) {
  md += "\n## Metrics Needing Attention\n\n";
  md += "| Page | Metric | Value | Status | Target (Good) |\n";
  md += "| --- | --- | --- | --- | --- |\n";
  for (const { url, metric, value, status } of allAlerts) {
    const spec = cwvSpec[metric];
    const target = metric === "cls_p75" ? `≤ ${spec.good}` : `≤ ${spec.good}${spec.unit}`;
    md += `| ${url} | ${spec.label} | ${fmtValue(metric, value)} | ${STATUS_ICON[status]} ${status} | ${target} |\n`;
  }
} else {
  md += "\n✅ All pages are within Google's CWV \"Good\" thresholds.\n";
}

writeFileSync(outFile, md, "utf8");
console.log(`Wrote CWV alerts to ${outFile}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `has_cwv_alerts=${allAlerts.length > 0}\n`);
}
