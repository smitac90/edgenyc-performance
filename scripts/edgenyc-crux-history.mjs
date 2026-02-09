#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const apiKeyFromEnv = process.env.CRUX_API_KEY;
const keyFile = join(process.cwd(), ".crux_api_key");
const apiKeyFromFile = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
const apiKey = apiKeyFromEnv || apiKeyFromFile;
if (!apiKey) {
  console.error("CRUX_API_KEY is not set and .crux_api_key was not found.");
  process.exit(1);
}

const urls = [
  "https://edgenyc.com/",
  "https://edgenyc.com/get-tickets",
];

const origin = "https://edgenyc.com";

const outDir = process.env.OUT_DIR || "data";
const outFile = `${outDir}/edgenyc-crux-history.csv`;

mkdirSync(outDir, { recursive: true });

const endpoint = `https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=${apiKey}`;

const metrics = [
  "largest_contentful_paint",
  "cumulative_layout_shift",
  "interaction_to_next_paint",
  "experimental_time_to_first_byte",
];

async function fetchHistory({ url, origin }) {
  const body = {
    metrics,
    collectionPeriodCount: 40,
  };

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
    throw new Error(`CrUX History API error for ${label}: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
}

function dateObjToISO(d) {
  if (!d) return "";
  const yyyy = String(d.year).padStart(4, "0");
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getP75s(record, metric) {
  return record?.metrics?.[metric]?.percentilesTimeseries?.p75s || [];
}

const header = [
  "period_start",
  "period_end",
  "url",
  "lcp_p75_ms",
  "cls_p75",
  "inp_p75_ms",
  "ttfb_p75_ms",
].join(",") + "\n";

(async () => {
  const rows = [];
  let anyUrlData = false;
  const missingUrls = [];

  for (const url of urls) {
    let data;
    let label = url;
    try {
      data = await fetchHistory({ url });
      anyUrlData = true;
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes("data not found") || msg.includes("404")) {
        missingUrls.push(url);
        continue;
      }
      throw err;
    }

    const record = data.record || {};
    const periods = data.record?.collectionPeriods || data.collectionPeriods || [];

    const lcp = getP75s(record, "largest_contentful_paint");
    const cls = getP75s(record, "cumulative_layout_shift");
    const inp = getP75s(record, "interaction_to_next_paint");
    const ttfb = getP75s(record, "experimental_time_to_first_byte");

    for (let i = 0; i < periods.length; i += 1) {
      const p = periods[i];
      const start = dateObjToISO(p.firstDate || p.first_date || p.startDate);
      const end = dateObjToISO(p.lastDate || p.endDate || p.end_date || p.end);

      rows.push([
        start,
        end,
        label,
        lcp[i] ?? "",
        cls[i] ?? "",
        inp[i] ?? "",
        ttfb[i] ?? "",
      ].join(","));
    }
  }

  if (!anyUrlData) {
    let originData;
    try {
      originData = await fetchHistory({ origin });
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes("data not found") || msg.includes("404")) {
        writeFileSync(outFile, header, "utf8");
        console.log(
          `No CrUX history found for URLs or origin. Wrote header only to ${outFile}`
        );
        return;
      }
      throw err;
    }

    const record = originData.record || {};
    const periods = originData.record?.collectionPeriods || originData.collectionPeriods || [];

    const lcp = getP75s(record, "largest_contentful_paint");
    const cls = getP75s(record, "cumulative_layout_shift");
    const inp = getP75s(record, "interaction_to_next_paint");
    const ttfb = getP75s(record, "experimental_time_to_first_byte");

    for (let i = 0; i < periods.length; i += 1) {
      const p = periods[i];
      const start = dateObjToISO(p.firstDate || p.first_date || p.startDate);
      const end = dateObjToISO(p.lastDate || p.endDate || p.end_date || p.end);

      rows.push([
        start,
        end,
        `origin:${origin}`,
        lcp[i] ?? "",
        cls[i] ?? "",
        inp[i] ?? "",
        ttfb[i] ?? "",
      ].join(","));
    }
  }

  writeFileSync(outFile, header + rows.join("\n") + "\n", "utf8");
  console.log(`Wrote ${rows.length} rows to ${outFile}`);
})();
