#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { originFromUrl, resolveUrlsFromConfig } from "./lib/url-source.mjs";

const apiKeyFromEnv = process.env.CRUX_API_KEY || process.env.PSI_API_KEY;
const keyFile = join(process.cwd(), ".crux_api_key");
const apiKeyFromFile = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
const apiKey = apiKeyFromEnv || apiKeyFromFile;
if (!apiKey) {
  console.error("CRUX_API_KEY is not set and .crux_api_key was not found.");
  process.exit(1);
}

const configPath = process.env.CONFIG_PATH || "config/edgenyc.json";
const configRaw = readFileSync(configPath, "utf8");
const config = JSON.parse(configRaw);

const urls = resolveUrlsFromConfig(config, {
  urlSource: config.cwv_url_source || config.lighthouse_url_source || {},
  purposeLabel: "CWV",
});
if (!urls.length) {
  console.error("No URLs configured for CWV snapshots. Set config.urls or cwv_url_source.");
  process.exit(1);
}

const thresholds = config.psi_thresholds || config.cwv_thresholds || {};
const outDir = process.env.OUT_DIR || "data";
const outFile = `${outDir}/edgenyc-cwv-daily.csv`;
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

const endpoint = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${apiKey}`;
const nowIso = new Date().toISOString();
const metricKeys = [
  "largest_contentful_paint",
  "cumulative_layout_shift",
  "interaction_to_next_paint",
  "experimental_time_to_first_byte",
];

function p75(record, metricKey) {
  return record?.metrics?.[metricKey]?.percentiles?.p75 ?? "";
}

function isCruxNoData(status, text) {
  if (status === 404) return true;
  return /data not found|does not have sufficient real-world speed data/i.test(text || "");
}

async function fetchCruxRecord({ url, origin }) {
  const body = { metrics: metricKeys };
  if (url) body.url = url;
  if (origin) body.origin = origin;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const label = url || origin || "unknown";
    const err = new Error(`CrUX API error for ${label}: ${res.status} ${res.statusText} - ${text}`);
    err.noData = isCruxNoData(res.status, text);
    throw err;
  }

  return res.json();
}

const rows = [];
const originCache = new Map();
for (const url of urls) {
  let scope = "none";
  let record = null;

  try {
    const urlData = await fetchCruxRecord({ url });
    record = urlData.record || null;
    scope = record ? "url" : "none";
  } catch (err) {
    if (!err.noData) throw err;
    const origin = originFromUrl(url);
    if (origin) {
      if (originCache.has(origin)) {
        record = originCache.get(origin);
        scope = record ? "origin" : "none";
      } else {
        try {
          const originData = await fetchCruxRecord({ origin });
          record = originData.record || null;
          originCache.set(origin, record);
          scope = record ? "origin" : "none";
        } catch (originErr) {
          if (!originErr.noData) throw originErr;
          originCache.set(origin, null);
        }
      }
    }
  }

  rows.push([
    nowIso,
    url,
    scope,
    p75(record, "largest_contentful_paint"),
    p75(record, "cumulative_layout_shift"),
    p75(record, "interaction_to_next_paint"),
    p75(record, "experimental_time_to_first_byte"),
  ].join(","));
}

appendFileSync(outFile, rows.join("\n") + "\n", "utf8");
console.log(`Appended ${rows.length} rows to ${outFile}`);
