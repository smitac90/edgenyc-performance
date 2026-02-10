#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

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

writeFileSync(outFile, md, "utf8");
console.log(`Wrote summary to ${outFile}`);
