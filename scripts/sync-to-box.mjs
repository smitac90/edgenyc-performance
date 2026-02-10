#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const defaultBoxDir = "/Users/andysmith/Library/CloudStorage/Box-Box/Andy's Box Drive/Codex Automations/Lighthouse Reports";
const boxDir = process.env.BOX_DIR || defaultBoxDir;

function runGitPull() {
  try {
    execFileSync("git", ["pull", "--rebase"], { stdio: "inherit" });
  } catch (err) {
    console.error("Failed to git pull. Make sure you're in the repo and have access.");
    process.exit(1);
  }
}

function copyLatest(dir, patternExts) {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => patternExts.some((ext) => f.endsWith(ext)));
  for (const file of files) {
    const src = join(dir, file);
    const dest = join(boxDir, file);
    copyFileSync(src, dest);
  }
}

mkdirSync(boxDir, { recursive: true });

runGitPull();
copyLatest("data", [".csv"]);
copyLatest("reports", [".md"]);

console.log(`Synced CSVs and reports to ${boxDir}`);
