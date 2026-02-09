#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const urls = [
  "https://edgenyc.com/",
  "https://edgenyc.com/get-tickets",
];

const outDir = process.env.OUT_DIR || "data";
const outFile = `${outDir}/edgenyc-daily.csv`;

mkdirSync(outDir, { recursive: true });

const columns = [
  "timestamp_iso",
  "url",
  "lh_performance",
  "lcp_ms",
  "cls",
  "inp_ms",
  "ttfb_ms",
  "tbt_ms",
  "speed_index_ms",
];

const descriptions = [
  "ISO timestamp of the run (UTC)",
  "Page URL measured",
  "Lighthouse Performance score (0-100)",
  "Largest Contentful Paint (ms)",
  "Cumulative Layout Shift (unitless)",
  "Interaction to Next Paint (ms)",
  "Time to First Byte (ms)",
  "Total Blocking Time (ms)",
  "Speed Index (ms)",
];

const targets = [
  "target: n/a",
  "target: n/a",
  "target: >= 90",
  "target: <= 2500",
  "target: <= 0.1",
  "target: <= 200",
  "target: <= 800",
  "target: <= 200",
  "target: <= 3400",
];

const header = [
  descriptions.join(","),
  targets.join(","),
  columns.join(","),
].join("\n") + "\n";

if (!existsSync(outFile)) {
  writeFileSync(outFile, header, "utf8");
}

const nowIso = new Date().toISOString();

function runLighthouse(url) {
  const tmpPath = join(tmpdir(), `lh-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const args = [
    "lighthouse",
    url,
    "--output=json",
    `--output-path=${tmpPath}`,
    "--only-categories=performance",
    "--quiet",
    "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
  ];

  try {
    execFileSync("npx", args, { stdio: "ignore" });
  } catch (err) {
    throw new Error(
      `Failed to run Lighthouse for ${url}. Make sure Node.js is installed and lighthouse can run (npx lighthouse ...).`
    );
  }

  const raw = readFileSync(tmpPath, "utf8");
  const json = JSON.parse(raw);

  const perf = Math.round((json.categories?.performance?.score ?? 0) * 100);
  const audits = json.audits ?? {};

  const metrics = {
    lcp_ms: audits["largest-contentful-paint"]?.numericValue,
    cls: audits["cumulative-layout-shift"]?.numericValue,
    inp_ms: audits["interaction-to-next-paint"]?.numericValue,
    ttfb_ms: audits["server-response-time"]?.numericValue,
    tbt_ms: audits["total-blocking-time"]?.numericValue,
    speed_index_ms: audits["speed-index"]?.numericValue,
  };

  return {
    perf,
    ...metrics,
  };
}

const rows = [];
for (const url of urls) {
  const result = runLighthouse(url);
  const row = [
    nowIso,
    url,
    result.perf,
    result.lcp_ms ?? "",
    result.cls ?? "",
    result.inp_ms ?? "",
    result.ttfb_ms ?? "",
    result.tbt_ms ?? "",
    result.speed_index_ms ?? "",
  ].join(",");
  rows.push(row);
}

appendFileSync(outFile, rows.join("\n") + "\n", "utf8");
console.log(`Appended ${rows.length} rows to ${outFile}`);
