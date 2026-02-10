#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const apiKeyFromEnv = process.env.PSI_API_KEY || process.env.CRUX_API_KEY;
const keyFile = join(process.cwd(), ".crux_api_key");
const apiKeyFromFile = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
const apiKey = apiKeyFromEnv || apiKeyFromFile;
if (!apiKey) {
  console.error("PSI_API_KEY/CRUX_API_KEY is not set and .crux_api_key was not found.");
  process.exit(1);
}

const configPath = process.env.CONFIG_PATH || "config/edgenyc.json";
const configRaw = readFileSync(configPath, "utf8");
const config = JSON.parse(configRaw);

const urls = config.urls || [];
const thresholds = config.psi_thresholds || {};

const outDir = process.env.OUT_DIR || "data";
const outFile = `${outDir}/edgenyc-psi-weekly.csv`;

mkdirSync(outDir, { recursive: true });

const columns = [
  "timestamp_iso",
  "url",
  "field_scope",
  "lcp_p75_ms",
  "cls_p75",
  "inp_p75_ms",
  "ttfb_p75_ms",
];

const descriptions = [
  "ISO timestamp of the run (UTC)",
  "Page URL measured",
  "Field data scope used (url|origin|none)",
  "Largest Contentful Paint p75 (ms)",
  "Cumulative Layout Shift p75 (unitless)",
  "Interaction to Next Paint p75 (ms)",
  "Time to First Byte p75 (ms)",
];

const targets = [
  "target: n/a",
  "target: n/a",
  "target: url preferred",
  `target: <= ${thresholds.lcp_p75_ms ?? 2500}`,
  `target: <= ${thresholds.cls_p75 ?? 0.1}`,
  `target: <= ${thresholds.inp_p75_ms ?? 200}`,
  `target: <= ${thresholds.ttfb_p75_ms ?? 800}`,
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

function metricP75(metrics, key) {
  return metrics?.[key]?.percentile;
}

async function fetchPSI(url) {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.set("key", apiKey);

  const res = await fetch(endpoint, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PSI API error for ${url}: ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json();
}

const nowIso = new Date().toISOString();

const rows = [];
for (const url of urls) {
  const data = await fetchPSI(url);
  const field = data.loadingExperience || data.originLoadingExperience || null;
  const scope = data.loadingExperience
    ? "url"
    : data.originLoadingExperience
      ? "origin"
      : "none";

  const metrics = field?.metrics || {};

  rows.push([
    nowIso,
    url,
    scope,
    metricP75(metrics, "LARGEST_CONTENTFUL_PAINT_MS") ?? "",
    metricP75(metrics, "CUMULATIVE_LAYOUT_SHIFT_SCORE") ?? "",
    metricP75(metrics, "INTERACTION_TO_NEXT_PAINT") ?? "",
    metricP75(metrics, "EXPERIMENTAL_TIME_TO_FIRST_BYTE") ?? "",
  ].join(","));
}

appendFileSync(outFile, rows.join("\n") + "\n", "utf8");
console.log(`Appended ${rows.length} rows to ${outFile}`);
