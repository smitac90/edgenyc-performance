#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GoogleAuth } from "google-auth-library";

const configPath = process.env.CONFIG_PATH || "config/edgenyc.json";
const configRaw = readFileSync(configPath, "utf8");
const config = JSON.parse(configRaw);

const gsc = config.gsc || {};
const siteUrl = gsc.site_url;
if (!siteUrl) {
  console.error("Missing gsc.site_url in config/edgenyc.json");
  process.exit(1);
}

const outDir = process.env.OUT_DIR || "data";
mkdirSync(outDir, { recursive: true });

const pagesFile = `${outDir}/edgenyc-gsc-pages-daily.csv`;
const queriesFile = `${outDir}/edgenyc-gsc-queries-daily.csv`;

const lagDays = Number(gsc.lag_days ?? 2);
const rowLimitPages = Number(gsc.row_limit_pages ?? 1000);
const rowLimitQueries = Number(gsc.row_limit_queries ?? 1000);
const includeQueries = Boolean(gsc.include_queries ?? true);

function getDateInPT(offsetDays) {
  const now = new Date();
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  pt.setDate(pt.getDate() + offsetDays);
  const yyyy = pt.getFullYear();
  const mm = String(pt.getMonth() + 1).padStart(2, "0");
  const dd = String(pt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const endDate = getDateInPT(-lagDays);
const startDate = endDate;

const scopes = ["https://www.googleapis.com/auth/webmasters.readonly"];

function loadServiceAccount() {
  const jsonEnv = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (jsonEnv) {
    return JSON.parse(jsonEnv);
  }

  const keyFile = process.env.GSC_SERVICE_ACCOUNT_FILE || ".gsc_service_account.json";
  if (existsSync(keyFile)) {
    return JSON.parse(readFileSync(keyFile, "utf8"));
  }

  console.error("Missing GSC service account JSON. Set GSC_SERVICE_ACCOUNT_JSON or provide .gsc_service_account.json");
  process.exit(1);
}

async function getAuthClient() {
  const credentials = loadServiceAccount();
  const auth = new GoogleAuth({ credentials, scopes });
  return auth.getClient();
}

async function querySearchAnalytics(client, body) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await client.request({
    url,
    method: "POST",
    data: body,
  });
  return res.data;
}

function ensureHeader(filePath, columns, descriptions, targets) {
  const header = [
    descriptions.join(","),
    targets.join(","),
    columns.join(","),
  ].join("\n") + "\n";

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

const baseColumns = [
  "timestamp_iso",
  "date",
  "url",
  "clicks",
  "impressions",
  "ctr",
  "position",
];

const baseDescriptions = [
  "ISO timestamp of the run (UTC)",
  "Date in PT used for the query",
  "Page URL",
  "Clicks",
  "Impressions",
  "Click-through rate",
  "Average position",
];

const baseTargets = [
  "target: n/a",
  "target: n/a",
  "target: n/a",
  "target: n/a",
  "target: n/a",
  "target: n/a",
  "target: n/a",
];

const pagesColumns = baseColumns;
const queriesColumns = [
  "timestamp_iso",
  "date",
  "query",
  "clicks",
  "impressions",
  "ctr",
  "position",
];

ensureHeader(pagesFile, pagesColumns, baseDescriptions, baseTargets);
ensureHeader(queriesFile, queriesColumns, [
  "ISO timestamp of the run (UTC)",
  "Date in PT used for the query",
  "Search query",
  "Clicks",
  "Impressions",
  "Click-through rate",
  "Average position",
], baseTargets);

const nowIso = new Date().toISOString();

const client = await getAuthClient();

const pageBody = {
  startDate,
  endDate,
  dimensions: ["page"],
  rowLimit: rowLimitPages,
  type: "web",
};

const pageData = await querySearchAnalytics(client, pageBody);
const pageRows = (pageData.rows || []).map((row) => [
  nowIso,
  endDate,
  row.keys?.[0] ?? "",
  row.clicks ?? "",
  row.impressions ?? "",
  row.ctr ?? "",
  row.position ?? "",
].join(","));

appendFileSync(pagesFile, pageRows.join("\n") + "\n", "utf8");

if (includeQueries) {
  const queryBody = {
    startDate,
    endDate,
    dimensions: ["query"],
    rowLimit: rowLimitQueries,
    type: "web",
  };

  const queryData = await querySearchAnalytics(client, queryBody);
  const queryRows = (queryData.rows || []).map((row) => [
    nowIso,
    endDate,
    row.keys?.[0] ?? "",
    row.clicks ?? "",
    row.impressions ?? "",
    row.ctr ?? "",
    row.position ?? "",
  ].join(","));

  appendFileSync(queriesFile, queryRows.join("\n") + "\n", "utf8");
}

console.log(
  `Wrote GSC data for ${endDate}. Pages: ${pageRows.length}, Queries: ${includeQueries ? pageRows.length : 0}`
);
