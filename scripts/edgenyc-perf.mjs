#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configPath = process.env.CONFIG_PATH || "config/edgenyc.json";
const configRaw = readFileSync(configPath, "utf8");
const config = JSON.parse(configRaw);

const urls = config.urls || [];
const strategies = config.lighthouse_strategies || ["mobile", "desktop"];
const runs = Math.max(1, Number(config.lighthouse_runs || 1));
const thresholds = config.thresholds || {};

const outDir = process.env.OUT_DIR || "data";
const outFile = `${outDir}/edgenyc-daily.csv`;

mkdirSync(outDir, { recursive: true });

const columns = [
  "timestamp_iso",
  "url",
  "strategy",
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
  "Lighthouse strategy (mobile|desktop)",
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
  "target: n/a",
  `target: >= ${thresholds.lh_performance ?? 90}`,
  `target: <= ${thresholds.lcp_ms ?? 2500}`,
  `target: <= ${thresholds.cls ?? 0.1}`,
  `target: <= ${thresholds.inp_ms ?? 200}`,
  `target: <= ${thresholds.ttfb_ms ?? 800}`,
  `target: <= ${thresholds.tbt_ms ?? 200}`,
  `target: <= ${thresholds.speed_index_ms ?? 3400}`,
];

const header = [
  descriptions.join(","),
  targets.join(","),
  columns.join(","),
].join("\n") + "\n";

function ensureHeader(filePath) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, header, "utf8");
    return;
  }

  const existing = readFileSync(filePath, "utf8");
  const lines = existing.split(/\r?\n/);
  const currentColumns = lines[2] || "";
  if (currentColumns.trim() === columns.join(",")) return;

  let startIdx = 0;
  if (lines[0]?.startsWith("ISO timestamp") && lines[2]?.includes("timestamp_iso")) {
    startIdx = 3;
  }

  const rest = lines.slice(startIdx).filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""));
  const updated = header + (rest.length ? rest.join("\n") + "\n" : "");
  writeFileSync(filePath, updated, "utf8");
}

ensureHeader(outFile);

const nowIso = new Date().toISOString();

function runLighthouse(url, strategy) {
  const tmpPath = join(tmpdir(), `lh-${strategy}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const args = [
    "lighthouse",
    url,
    "--output=json",
    `--output-path=${tmpPath}`,
    "--only-categories=performance",
    "--quiet",
    "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
  ];

  if (strategy === "desktop") {
    args.push("--preset=desktop");
  }

  try {
    execFileSync("npx", args, { stdio: "ignore" });
  } catch (err) {
    throw new Error(
      `Failed to run Lighthouse (${strategy}) for ${url}. Make sure Node.js is installed and lighthouse can run (npx lighthouse ...).`
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

function avg(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function aggregateRuns(url, strategy) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    samples.push(runLighthouse(url, strategy));
  }

  return {
    perf: avg(samples.map((s) => s.perf)),
    lcp_ms: avg(samples.map((s) => s.lcp_ms)),
    cls: avg(samples.map((s) => s.cls)),
    inp_ms: avg(samples.map((s) => s.inp_ms)),
    ttfb_ms: avg(samples.map((s) => s.ttfb_ms)),
    tbt_ms: avg(samples.map((s) => s.tbt_ms)),
    speed_index_ms: avg(samples.map((s) => s.speed_index_ms)),
  };
}

const rows = [];
for (const url of urls) {
  for (const strategy of strategies) {
    const result = aggregateRuns(url, strategy);
    const row = [
      nowIso,
      url,
      strategy,
      result.perf ?? "",
      result.lcp_ms ?? "",
      result.cls ?? "",
      result.inp_ms ?? "",
      result.ttfb_ms ?? "",
      result.tbt_ms ?? "",
      result.speed_index_ms ?? "",
    ].join(",");
    rows.push(row);
  }
}

appendFileSync(outFile, rows.join("\n") + "\n", "utf8");
console.log(`Appended ${rows.length} rows to ${outFile}`);
