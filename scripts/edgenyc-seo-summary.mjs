#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const gscPages = "data/edgenyc-gsc-pages-daily.csv";
const semrushPages = "data/edgenyc-semrush-pages.csv";
const outFile = "reports/seo-summary.md";

mkdirSync("reports", { recursive: true });

function readCsv(path) {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 4) return null;
  const header = lines[2].split(",");
  const data = lines.slice(3).map((line) => line.split(","));
  return { header, data };
}

function idx(header, name) {
  return header.indexOf(name);
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const gsc = readCsv(gscPages);
const semrush = readCsv(semrushPages);

let md = "# SEO Summary\n\n";

if (!gsc) {
  md += "GSC data not found yet.\n\n";
} else {
  const iDate = idx(gsc.header, "date");
  const iUrl = idx(gsc.header, "url");
  const iClicks = idx(gsc.header, "clicks");
  const iImpr = idx(gsc.header, "impressions");

  const dates = gsc.data.map((r) => r[iDate]).filter(Boolean);
  const latest = dates.sort().slice(-1)[0];
  const last7 = dates.sort().slice(-7);
  const last7Set = new Set(last7);

  const agg = new Map();
  for (const r of gsc.data) {
    if (!last7Set.has(r[iDate])) continue;
    const url = r[iUrl];
    const clicks = toNumber(r[iClicks]);
    const imps = toNumber(r[iImpr]);
    const cur = agg.get(url) || { clicks: 0, impressions: 0 };
    cur.clicks += clicks;
    cur.impressions += imps;
    agg.set(url, cur);
  }

  const top = [...agg.entries()]
    .sort((a, b) => b[1].clicks - a[1].clicks)
    .slice(0, 10);

  md += `## GSC Top Pages (Last ${last7.length} days, ending ${latest})\n\n`;
  md += "| Page | Clicks | Impressions |\n";
  md += "| --- | --- | --- |\n";
  for (const [url, stats] of top) {
    md += `| ${url} | ${Math.round(stats.clicks)} | ${Math.round(stats.impressions)} |\n`;
  }
  md += "\n";
}

if (!semrush) {
  md += "Semrush data not found yet.\n\n";
} else {
  const iDate = idx(semrush.header, "report_date");
  const iUrl = idx(semrush.header, "url");
  const iTraffic = idx(semrush.header, "traffic");
  const iRegion = idx(semrush.header, "region");

  const dates = semrush.data.map((r) => r[iDate]).filter(Boolean);
  const latest = dates.sort().slice(-1)[0];
  const latestRows = semrush.data.filter((r) => r[iDate] === latest);
  const region = latestRows[0]?.[iRegion] || "";

  const top = latestRows
    .sort((a, b) => toNumber(b[iTraffic]) - toNumber(a[iTraffic]))
    .slice(0, 10);

  md += `## Semrush Top Pages (${region} report date ${latest})\n\n`;
  md += "| Page | Est. Traffic |\n";
  md += "| --- | --- |\n";
  for (const r of top) {
    md += `| ${r[iUrl]} | ${r[iTraffic]} |\n`;
  }
  md += "\n";
}

writeFileSync(outFile, md, "utf8");
console.log(`Wrote SEO summary to ${outFile}`);
