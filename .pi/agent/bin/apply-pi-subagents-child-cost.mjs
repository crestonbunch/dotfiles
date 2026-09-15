#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const EXPECTED_VERSION = "0.66.0";
const agentDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(agentDir, "npm", "node_modules", "pi-subagents");
const patchPath = join(agentDir, "patches", "pi-subagents-0.66.0-child-cost-api.patch.b64");
const patch = Buffer.from(readFileSync(patchPath, "utf8").replaceAll(/\s/g, ""), "base64");

const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
if (packageJson.version !== EXPECTED_VERSION) {
  console.error(`Refusing to patch pi-subagents ${packageJson.version}; expected ${EXPECTED_VERSION}.`);
  process.exit(1);
}

const gitApply = (...args) => spawnSync("git", ["apply", ...args], {
  cwd: packageDir,
  encoding: "utf8",
  input: patch,
});

if (gitApply("--check").status === 0) {
  const applied = gitApply();
  if (applied.status !== 0) {
    console.error(applied.stderr.trim() || "git apply failed");
    process.exit(applied.status ?? 1);
  }
  console.log(`Applied child-cost API patch to pi-subagents ${EXPECTED_VERSION}.`);
  process.exit(0);
}

if (gitApply("--reverse", "--check").status === 0) {
  console.log(`Child-cost API patch is already applied to pi-subagents ${EXPECTED_VERSION}.`);
  process.exit(0);
}

console.error("Refusing to patch: installed pi-subagents files do not match the expected original or patched state.");
process.exit(1);
