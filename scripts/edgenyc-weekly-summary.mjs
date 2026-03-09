#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

// CWV 3-tier classification (Good / Needs Improvement / Poor)
const cwvSpec = {
  lcp_p75_ms:  { label: "LCP",  good: 2500, poor: 4000,  unit: "ms" },
  cls_p75:     { label: "CLS",  good: 0.1,  poor: 0.25,  unit: "" },
  inp_p75_ms:  { label: "INP",  good: 200,  poor: 500,   unit: "ms" },
  ttfb_p75_ms: { label: "TTFB", good: 800,  poor: 1800,  unit: "ms" },
};

function classifyCwv(metric, value) {
  const spec = cwvSpec[metric];
  if (!spec || value === null) return null;
  if (value <= spec.good) return "Good";
  if (value <= spec.poor) return "Needs Improvement";
  return "Poor";
}

const STATUS_ICON = { Good: "✅", "Needs Improvement": "⚠️", Poor: "❌" };

function fmtCwvCell(metric, value) {
  if (value === null) return "n/a";
  const spec = cwvSpec[metric];
  const raw = metric === "cls_p75" ? value.toFixed(3) : Math.round(value).toString();
  const status = classifyCwv(metric, value);
  return `${raw}${spec.unit} ${STATUS_ICON[status]}`;
}

const dataFile = process.env.DAILY_CSV || "data/edgenyc-daily.csv";
const outFile = process.env.SUMMARY_OUT || "reports/weekly-summary.md";

if (!existsSync(dataFile)) {
  console.error(`Daily CSV not found at ${dataFile}`);
  process.exit(1);
}

mkdirSync("reports", { recursive: true });

const raw = readFileSync(dataFile, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);

if (lines.length < 4) {
  writeFileSync(outFile, "# Weekly Performance Summary\n\nNo data available yet.\n", "utf8");
  console.log(`Wrote empty summary to ${outFile}`);
  process.exit(0);
}

const columns = lines[2].split(",");
const dataLines = lines.slice(3);

function parseRow(line) {
  const parts = line.split(",");
  const row = {};
  for (let i = 0; i < columns.length; i += 1) {
    row[columns[i]] = parts[i] ?? "";
  }
  return row;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(values) {
  const nums = values.filter((v) => v !== null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const rows = dataLines.map(parseRow).filter((r) => r.timestamp_iso && r.url);

const now = new Date();
const oneDayMs = 24 * 60 * 60 * 1000;
const last7Start = new Date(now.getTime() - 7 * oneDayMs);
const prev7Start = new Date(now.getTime() - 14 * oneDayMs);
const prev7End = new Date(now.getTime() - 7 * oneDayMs);

function inRange(ts, start, end) {
  const d = new Date(ts);
  return d >= start && d < end;
}

function groupKey(row) {
  return `${row.url} | ${row.strategy || "mobile"}`;
}

const groups = new Map();
for (const row of rows) {
  const key = groupKey(row);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const metrics = [
  "lh_performance",
  "lcp_ms",
  "cls",
  "inp_ms",
  "ttfb_ms",
  "tbt_ms",
  "speed_index_ms",
];

function formatMetric(name, value) {
  if (value === null) return "n/a";
  if (name === "cls") return value.toFixed(3);
  if (name === "lh_performance") return value.toFixed(1);
  return Math.round(value).toString();
}

function formatDelta(value) {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

let md = "# Weekly Performance Summary\n\n";
md += `Range: ${last7Start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)} (last 7 days)\n\n`;
md += "## Averages (Last 7 Days)\n\n";
md += "| Page | Strategy | Perf | LCP | CLS | INP | TTFB | TBT | Speed Index |\n";
md += "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";

for (const [key, groupRows] of groups) {
  const [url, strategy] = key.split(" | ");
  const last7 = groupRows.filter((r) => inRange(r.timestamp_iso, last7Start, now));
  const prev7 = groupRows.filter((r) => inRange(r.timestamp_iso, prev7Start, prev7End));

  const lastAvg = {};
  const prevAvg = {};
  for (const metric of metrics) {
    lastAvg[metric] = avg(last7.map((r) => toNumber(r[metric])));
    prevAvg[metric] = avg(prev7.map((r) => toNumber(r[metric])));
  }

  md += `| ${url} | ${strategy} | ${formatMetric("lh_performance", lastAvg.lh_performance)} | ${formatMetric("lcp_ms", lastAvg.lcp_ms)} | ${formatMetric("cls", lastAvg.cls)} | ${formatMetric("inp_ms", lastAvg.inp_ms)} | ${formatMetric("ttfb_ms", lastAvg.ttfb_ms)} | ${formatMetric("tbt_ms", lastAvg.tbt_ms)} | ${formatMetric("speed_index_ms", lastAvg.speed_index_ms)} |\n`;

  md += `| ${url} | ${strategy} Δ | ${formatDelta(lastAvg.lh_performance - prevAvg.lh_performance)} | ${formatDelta(lastAvg.lcp_ms - prevAvg.lcp_ms)} | ${formatDelta(lastAvg.cls - prevAvg.cls)} | ${formatDelta(lastAvg.inp_ms - prevAvg.inp_ms)} | ${formatDelta(lastAvg.ttfb_ms - prevAvg.ttfb_ms)} | ${formatDelta(lastAvg.tbt_ms - prevAvg.tbt_ms)} | ${formatDelta(lastAvg.speed_index_ms - prevAvg.speed_index_ms)} |\n`;
}

md += "\nNotes:\n";
md += "- Perf increases are good; decreases are bad. For timing metrics, lower is better.\n";
md += "- Δ rows compare the last 7 days against the previous 7 days.\n";

// --- Field CWV section (from CrUX data) ---
const cwvFile = process.env.CWV_CSV || "data/edgenyc-cwv-daily.csv";
if (existsSync(cwvFile)) {
  const cwvRaw = readFileSync(cwvFile, "utf8");
  const cwvLines = cwvRaw.split(/\r?\n/).filter(Boolean);

  if (cwvLines.length >= 4) {
    const cwvColumns = cwvLines[2].split(",");
    const cwvDataLines = cwvLines.slice(3);

    function parseCwvRow(line) {
      const parts = line.split(",");
      return Object.fromEntries(cwvColumns.map((col, i) => [col, parts[i] ?? ""]));
    }

    const cwvRows = cwvDataLines.map(parseCwvRow).filter((r) => r.timestamp_iso && r.url);

    // Last 7 days averages per URL
    const cwvGroups = new Map();
    for (const row of cwvRows) {
      if (!inRange(row.timestamp_iso, last7Start, now)) continue;
      if (!cwvGroups.has(row.url)) cwvGroups.set(row.url, []);
      cwvGroups.get(row.url).push(row);
    }

    if (cwvGroups.size > 0) {
      md += "\n## Field CWV Status (Last 7 Days, CrUX p75)\n\n";
      md += "| Page | Scope | LCP | CLS | INP | TTFB |\n";
      md += "| --- | --- | --- | --- | --- | --- |\n";

      for (const [url, urlRows] of cwvGroups) {
        const avgCwv = (metric) => avg(urlRows.map((r) => toNumber(r[metric])));
        const scope = urlRows[urlRows.length - 1]?.field_scope || "n/a";
        md += `| ${url} | ${scope} | ${fmtCwvCell("lcp_p75_ms", avgCwv("lcp_p75_ms"))} | ${fmtCwvCell("cls_p75", avgCwv("cls_p75"))} | ${fmtCwvCell("inp_p75_ms", avgCwv("inp_p75_ms"))} | ${fmtCwvCell("ttfb_p75_ms", avgCwv("ttfb_p75_ms"))} |\n`;
      }

      md += "\n**Key:** ✅ Good &nbsp; ⚠️ Needs Improvement &nbsp; ❌ Poor\n";
    }
  }
}

writeFileSync(outFile, md, "utf8");
console.log(`Wrote summary to ${outFile}`);
