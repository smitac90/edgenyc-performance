#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const configPath = process.env.CONFIG_PATH || "config/edgenyc.json";
const configRaw = readFileSync(configPath, "utf8");
const config = JSON.parse(configRaw);
const thresholds = config.thresholds || {};

const dataFile = process.env.DAILY_CSV || "data/edgenyc-daily.csv";
const outFile = process.env.ALERTS_OUT || "reports/alerts.md";

mkdirSync("reports", { recursive: true });

if (!existsSync(dataFile)) {
  writeFileSync(outFile, "# Performance Alerts\n\nNo data available.\n", "utf8");
  console.log("No data for alerts.");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "has_alerts=false\n");
  }
  process.exit(0);
}

const raw = readFileSync(dataFile, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);
if (lines.length < 4) {
  writeFileSync(outFile, "# Performance Alerts\n\nNo data available.\n", "utf8");
  console.log("No data for alerts.");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "has_alerts=false\n");
  }
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

const rows = dataLines.map(parseRow).filter((r) => r.timestamp_iso && r.url);

const latestByKey = new Map();
for (const row of rows) {
  const key = `${row.url}|${row.strategy || "mobile"}`;
  const existing = latestByKey.get(key);
  if (!existing || new Date(row.timestamp_iso) > new Date(existing.timestamp_iso)) {
    latestByKey.set(key, row);
  }
}

const alerts = [];

function checkMetric(row, metric, comparator, target) {
  const value = toNumber(row[metric]);
  if (value === null || target === undefined || target === null) return;
  const isBad = comparator(value, target);
  if (isBad) {
    alerts.push({
      url: row.url,
      strategy: row.strategy || "mobile",
      metric,
      value,
      target,
    });
  }
}

for (const row of latestByKey.values()) {
  checkMetric(row, "lh_performance", (v, t) => v < t, thresholds.lh_performance);
  checkMetric(row, "lcp_ms", (v, t) => v > t, thresholds.lcp_ms);
  checkMetric(row, "cls", (v, t) => v > t, thresholds.cls);
  checkMetric(row, "inp_ms", (v, t) => v > t, thresholds.inp_ms);
  checkMetric(row, "ttfb_ms", (v, t) => v > t, thresholds.ttfb_ms);
  checkMetric(row, "tbt_ms", (v, t) => v > t, thresholds.tbt_ms);
  checkMetric(row, "speed_index_ms", (v, t) => v > t, thresholds.speed_index_ms);
}

let md = "# Performance Alerts\n\n";
if (!alerts.length) {
  md += "No alert thresholds were breached in the latest run.\n";
} else {
  md += "The following metrics breached thresholds in the latest run:\n\n";
  md += "| Page | Strategy | Metric | Value | Target |\n";
  md += "| --- | --- | --- | --- | --- |\n";
  for (const alert of alerts) {
    const value = alert.metric === "cls" ? alert.value.toFixed(3) : Math.round(alert.value);
    const target = alert.metric === "cls" ? alert.target.toFixed(3) : alert.target;
    md += `| ${alert.url} | ${alert.strategy} | ${alert.metric} | ${value} | ${target} |\n`;
  }
}

writeFileSync(outFile, md, "utf8");
console.log(`Wrote alerts to ${outFile}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `has_alerts=${alerts.length > 0}\n`);
}
