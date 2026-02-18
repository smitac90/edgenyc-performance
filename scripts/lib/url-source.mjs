import { existsSync, readFileSync } from "node:fs";

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
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dedupeUrls(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl.trim());
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

function normalizeHost(hostOrUrl) {
  if (!hostOrUrl) return "";
  let hostname = hostOrUrl.trim();
  if (hostname.startsWith("http://") || hostname.startsWith("https://")) {
    try {
      hostname = new URL(hostname).hostname;
    } catch {
      return "";
    }
  } else {
    hostname = hostname.replace(/\/.*$/, "");
  }
  return hostname.toLowerCase().replace(/^www\./, "");
}

function getDomainFilter(config, urlSource) {
  const cfgDomain = normalizeHost(urlSource.domain || "");
  if (cfgDomain) return cfgDomain;
  const gscSite = normalizeHost(config.gsc?.site_url || "");
  return gscSite;
}

function resolveUrlsFromGscTopPages(config, urlSource, staticUrls, purposeLabel) {
  const gscFile = urlSource.gsc_pages_file || "data/edgenyc-gsc-pages-daily.csv";
  const topN = Math.max(1, Number(urlSource.top_n || 100));
  const lookbackDays = Math.max(1, Number(urlSource.lookback_days || 28));
  const domainFilter = getDomainFilter(config, urlSource);

  if (!existsSync(gscFile)) {
    console.warn(`GSC pages file not found at ${gscFile}; falling back to config.urls for ${purposeLabel} URLs`);
    return staticUrls;
  }

  const raw = readFileSync(gscFile, "utf8").trim();
  if (!raw) {
    console.warn(`GSC pages file is empty (${gscFile}); falling back to config.urls for ${purposeLabel} URLs`);
    return staticUrls;
  }

  const lines = raw.split(/\r?\n/);
  if (lines.length < 4) {
    console.warn(`GSC pages file has no data rows (${gscFile}); falling back to config.urls for ${purposeLabel} URLs`);
    return staticUrls;
  }

  const headerFields = parseCsvLine(lines[2] || "");
  const idx = (name) => headerFields.indexOf(name);
  const iDate = idx("date");
  const iUrl = idx("url");
  const iClicks = idx("clicks");
  const iImpressions = idx("impressions");

  if (iDate < 0 || iUrl < 0 || iClicks < 0 || iImpressions < 0) {
    console.warn(`GSC pages header missing required columns in ${gscFile}; falling back to config.urls for ${purposeLabel} URLs`);
    return staticUrls;
  }

  const rows = lines
    .slice(3)
    .filter(Boolean)
    .map((line) => parseCsvLine(line));

  const latestDate = rows
    .map((r) => r[iDate] || "")
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!latestDate) {
    console.warn(`No valid GSC dates found in ${gscFile}; falling back to config.urls for ${purposeLabel} URLs`);
    return staticUrls;
  }

  const cutoff = new Date(`${latestDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (lookbackDays - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const totals = new Map();
  for (const row of rows) {
    const date = row[iDate] || "";
    if (!date || date < cutoffDate) continue;

    const normalized = normalizeUrl(row[iUrl] || "");
    if (!normalized) continue;

    if (domainFilter) {
      const host = normalizeHost(normalized);
      if (host !== domainFilter) continue;
    }

    const current = totals.get(normalized) || { clicks: 0, impressions: 0 };
    current.clicks += parseNumber(row[iClicks]);
    current.impressions += parseNumber(row[iImpressions]);
    totals.set(normalized, current);
  }

  const topUrls = [...totals.entries()]
    .sort((a, b) =>
      b[1].impressions - a[1].impressions ||
      b[1].clicks - a[1].clicks ||
      a[0].localeCompare(b[0])
    )
    .slice(0, topN)
    .map(([url]) => url);

  if (!topUrls.length) {
    console.warn(`No top pages resolved from ${gscFile}; falling back to config.urls for ${purposeLabel} URLs`);
    return staticUrls;
  }

  console.log(
    `Resolved ${topUrls.length} ${purposeLabel} URLs from GSC top pages (${gscFile}, latest ${latestDate}, lookback ${lookbackDays}d)`
  );
  return topUrls;
}

export function resolveUrlsFromConfig(config, options = {}) {
  const source = options.urlSource || config.lighthouse_url_source || {};
  const purposeLabel = options.purposeLabel || "job";
  const staticUrls = dedupeUrls(config.urls || []);
  const mode = String(source.mode || "static");
  if (mode !== "gsc_top_pages") return staticUrls;
  return dedupeUrls(resolveUrlsFromGscTopPages(config, source, staticUrls, purposeLabel));
}

export function originFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return "";
  }
}
