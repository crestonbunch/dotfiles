#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const EXPECTED_VERSION = "0.66.0";
const agentDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(agentDir, "npm", "node_modules", "pi-subagents");
const patchPath = join(
  agentDir,
  "patches",
  "pi-subagents-0.66.0-child-cost-api.patch.b64",
);
const upgradePatchPath = join(
  agentDir,
  "patches",
  "pi-subagents-0.66.0-child-cost-api-v1-to-v2.patch.b64",
);
const readPatch = path =>
  Buffer.from(readFileSync(path, "utf8").replaceAll(/\s/g, ""), "base64");
const patch = readPatch(patchPath);
const upgradePatch = readPatch(upgradePatchPath);

const packageJson = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
);
if (packageJson.version !== EXPECTED_VERSION) {
  console.error(
    `Refusing to patch pi-subagents ${packageJson.version}; expected ${EXPECTED_VERSION}.`,
  );
  process.exit(1);
}

const gitApply = (input, ...args) =>
  spawnSync("git", ["apply", ...args], {
    cwd: packageDir,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CEILING_DIRECTORIES: dirname(packageDir),
    },
    input,
  });

if (gitApply(patch, "--check").status === 0) {
  const applied = gitApply(patch);
  if (applied.status !== 0) {
    console.error(applied.stderr.trim() || "git apply failed");
    process.exit(applied.status ?? 1);
  }
  console.log(
    `Applied child-cost API patch to pi-subagents ${EXPECTED_VERSION}.`,
  );
  process.exit(0);
}

if (gitApply(patch, "--reverse", "--check").status === 0) {
  console.log(
    `Child-cost API patch is already applied to pi-subagents ${EXPECTED_VERSION}.`,
  );
  process.exit(0);
}

if (gitApply(upgradePatch, "--check").status === 0) {
  const applied = gitApply(upgradePatch);
  if (applied.status !== 0) {
    console.error(applied.stderr.trim() || "git apply failed");
    process.exit(applied.status ?? 1);
  }
  console.log(
    `Upgraded child-cost API patch in pi-subagents ${EXPECTED_VERSION}.`,
  );
  process.exit(0);
}

console.error(
  "Refusing to patch: installed pi-subagents files do not match the expected original or patched state.",
);
process.exit(1);
