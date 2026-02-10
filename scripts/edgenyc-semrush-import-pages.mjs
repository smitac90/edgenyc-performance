#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const incomingDir = process.env.SEMRUSH_INCOMING || "data/incoming";
const outDir = process.env.OUT_DIR || "data";
const outFile = `${outDir}/edgenyc-semrush-pages.csv`;
const archiveDir = process.env.SEMRUSH_ARCHIVE || "data/semrush-archive";

mkdirSync(outDir, { recursive: true });
mkdirSync(archiveDir, { recursive: true });

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseReportDate(filename) {
  const match = filename.match(/(20\d{2})(\d{2})(\d{2})/);
  if (!match) return "";
  const [_, y, m, d] = match;
  return `${y}-${m}-${d}`;
}

function parseRegion(filename) {
  const match = filename.match(/-([a-z]{2})-20\d{2}/i);
  return match ? match[1].toUpperCase() : "";
}

const columns = [
  "timestamp_iso",
  "report_date",
  "region",
  "url",
  "traffic_pct",
  "keywords",
  "traffic",
  "adwords_positions",
  "positions_commercial_top20",
  "positions_informational_top20",
  "positions_navigational_top20",
  "positions_transactional_top20",
  "positions_unknown_top20",
  "traffic_commercial_top20",
  "traffic_informational_top20",
  "traffic_navigational_top20",
  "traffic_transactional_top20",
  "traffic_unknown_top20",
  "traffic_change",
];

const descriptions = [
  "ISO timestamp of the import (UTC)",
  "Report date extracted from filename",
  "Region/market from filename",
  "Page URL",
  "Traffic share (%)",
  "Number of ranking keywords",
  "Estimated organic traffic",
  "Adwords positions",
  "Positions with commercial intents in top 20",
  "Positions with informational intents in top 20",
  "Positions with navigational intents in top 20",
  "Positions with transactional intents in top 20",
  "Positions with unknown intents in top 20",
  "Traffic with commercial intents in top 20",
  "Traffic with informational intents in top 20",
  "Traffic with navigational intents in top 20",
  "Traffic with transactional intents in top 20",
  "Traffic with unknown intents in top 20",
  "Traffic change",
];

const targets = new Array(columns.length).fill("target: n/a");

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

const files = existsSync(incomingDir)
  ? readdirSync(incomingDir).filter((f) => f.endsWith('.csv'))
  : [];

if (!files.length) {
  console.log(`No CSV files found in ${incomingDir}`);
  process.exit(0);
}

const nowIso = new Date().toISOString();
let totalRows = 0;

for (const file of files) {
  const fullPath = join(incomingDir, file);
  const reportDate = parseReportDate(file);
  const region = parseRegion(file);
  const content = readFileSync(fullPath, "utf8").trim();
  if (!content) continue;
  const lines = content.split(/\r?\n/);
  const headerLine = lines[0];
  const headerFields = parseCsvLine(headerLine);

  const idx = (name) => headerFields.indexOf(name);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  const mapped = rows.map((r) => [
    nowIso,
    reportDate,
    region,
    r[idx("URL")] ?? "",
    r[idx("Traffic (%)")] ?? "",
    r[idx("Number of Keywords")] ?? "",
    r[idx("Traffic")] ?? "",
    r[idx("Adwords Positions")] ?? "",
    r[idx("Positions with commercial intents in top 20")] ?? "",
    r[idx("Positions with informational intents in top 20")] ?? "",
    r[idx("Positions with navigational intents in top 20")] ?? "",
    r[idx("Positions with transactional intents in top 20")] ?? "",
    r[idx("Positions with unknown intents in top 20")] ?? "",
    r[idx("Traffic with commercial intents in top 20")] ?? "",
    r[idx("Traffic with informational intents in top 20")] ?? "",
    r[idx("Traffic with navigational intents in top 20")] ?? "",
    r[idx("Traffic with transactional intents in top 20")] ?? "",
    r[idx("Traffic with unknown intents in top 20")] ?? "",
    r[idx("Traffic Change")] ?? "",
  ].join(","));

  appendFileSync(outFile, mapped.join("\n") + "\n", "utf8");
  totalRows += mapped.length;

  const archived = join(archiveDir, file);
  renameSync(fullPath, archived);
}

console.log(`Imported ${totalRows} rows into ${outFile}`);
