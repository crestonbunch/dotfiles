import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { applyModelChoices, loadModelChoices } from "../model-config.mjs";

const agentSource = fileURLToPath(new URL("../", import.meta.url));
const wrapper = fileURLToPath(new URL("../../../.local/bin/pi", import.meta.url));
const jjRunner = fileURLToPath(new URL("../../../.local/bin/jj-ai-run", import.meta.url));

const setUp = t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-model-config-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  copyFileSync(join(agentSource, "model-config.mjs"), join(agentDir, "model-config.mjs"));
  copyFileSync(join(agentSource, "model-defaults.json"), join(agentDir, "model-defaults.json"));
  copyFileSync(join(agentSource, "settings.defaults.json"), join(agentDir, "settings.defaults.json"));
  return {
    root,
    agentDir,
    local: value => writeFileSync(join(agentDir, "model-choices.local.json"), JSON.stringify(value)),
    settings: () => JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")),
  };
};

const fakePi = root => {
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pi"), `#!${process.execPath}
console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
`, { mode: 0o755 });
  return bin;
};

const envFor = (agentDir, bin) => ({
  ...process.env,
  PI_CODING_AGENT_DIR: agentDir,
  PATH: `${dirname(wrapper)}:${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
});

test("missing device choices generate the shared OpenAI defaults", t => {
  const fixture = setUp(t);
  applyModelChoices(fixture.agentDir);
  const settings = fixture.settings();
  assert.equal(settings.defaultProvider, "openai");
  assert.equal(settings.defaultModel, "gpt-6.1-terra");
  assert.equal(settings.defaultThinkingLevel, "high");
  assert.deepEqual(settings.subagents.agentOverrides.worker, { model: "openai/gpt-6.1-terra", thinking: "medium" });
  assert.deepEqual(settings.subagents.agentOverrides.advisor, { model: "openai/gpt-6-astra", thinking: "medium" });
  assert.deepEqual(settings.subagents.agentOverrides.reviewer, { model: "openai/gpt-6-luna", thinking: "high" });
  assert.equal(settings.subagents.agentOverrides.scout.disabled, true);
});

test("device choices independently configure exact models and effort per role", t => {
  const fixture = setUp(t);
  fixture.local({
    parent: { model: "openai-codex/gpt-6.1-sol", thinking: "medium" },
    defaultSubagent: { model: "openai-codex/gpt-6-luna" },
    agents: {
      worker: { model: "openai-codex/gpt-6.1-sol" },
      reviewer: { model: "openai-codex/gpt-6-astra", thinking: "low" },
    },
  });
  applyModelChoices(fixture.agentDir);
  const settings = fixture.settings();
  assert.equal(settings.defaultProvider, "openai-codex");
  assert.equal(settings.defaultThinkingLevel, "medium");
  assert.equal(settings.subagents.defaultModel, "openai-codex/gpt-6-luna");
  assert.equal(settings.subagents.defaultThinking, "low");
  assert.deepEqual(settings.subagents.agentOverrides.worker, { model: "openai-codex/gpt-6.1-sol", thinking: "medium" });
  assert.deepEqual(settings.subagents.agentOverrides.reviewer, { model: "openai-codex/gpt-6-astra", thinking: "low" });
  assert.deepEqual(settings.enabledModels, [
    "openai-codex/gpt-6.1-sol", "openai-codex/gpt-6-luna", "openai/gpt-6-luna", "openai/gpt-6-astra", "openai/gpt-6.1-terra", "openai-codex/gpt-6-astra",
  ]);
  assert.deepEqual(settings.subagents.modelScope, { enforce: true, strict: true, allow: settings.enabledModels });
});

test("explicit device scopes allow additional models without changing role assignments", t => {
  const fixture = setUp(t);
  const supportedModels = [
    "openai/gpt-6.1-terra",
    "openai/gpt-6-luna",
    "openai/gpt-6-astra",
    "amazon-bedrock/us.anthropic.claude-fable-5-1",
  ];
  fixture.local({ supportedModels });
  applyModelChoices(fixture.agentDir);
  const settings = fixture.settings();
  assert.equal(settings.defaultProvider, "openai");
  assert.equal(settings.defaultModel, "gpt-6.1-terra");
  assert.deepEqual(settings.enabledModels, supportedModels);
  assert.deepEqual(settings.subagents.modelScope, { enforce: true, strict: true, allow: supportedModels });
});

test("explicit scopes cannot omit a configured role model", t => {
  const fixture = setUp(t);
  writeFileSync(join(fixture.agentDir, "settings.json"), '{"theme":"light"}');
  fixture.local({ supportedModels: ["openai/gpt-6.1-terra", "openai/gpt-6-astra"] });
  assert.throws(() => applyModelChoices(fixture.agentDir), /supportedModels must include configured models: openai\/gpt-6-luna/);
  assert.equal(readFileSync(join(fixture.agentDir, "settings.json"), "utf8"), '{"theme":"light"}');
});

test("explicit scopes reject unqualified model IDs", t => {
  const fixture = setUp(t);
  fixture.local({ supportedModels: ["gpt-6.1-sol"] });
  assert.throws(() => loadModelChoices(fixture.agentDir), /supportedModels must be a non-empty array of exact provider\/model IDs/);
});

test("explicit scopes reject wildcard model patterns", t => {
  const fixture = setUp(t);
  fixture.local({ supportedModels: ["amazon-bedrock/us.*"] });
  assert.throws(() => loadModelChoices(fixture.agentDir), /supportedModels must be a non-empty array of exact provider\/model IDs/);
});

test("removing local choices restores defaults while preserving non-model runtime settings", t => {
  const fixture = setUp(t);
  writeFileSync(join(fixture.agentDir, "settings.json"), JSON.stringify({
    theme: "light", deviceId: "this-device", packages: ["local-package"],
    subagents: { agentOverrides: { worker: { tools: ["read"] } }, modelScope: { agents: { worker: { allow: ["old/model"] } } } },
  }));
  fixture.local({ parent: { model: "openai-codex/gpt-6.1-sol" } });
  applyModelChoices(fixture.agentDir);
  rmSync(join(fixture.agentDir, "model-choices.local.json"));
  applyModelChoices(fixture.agentDir);
  const settings = fixture.settings();
  assert.equal(settings.defaultProvider, "openai");
  assert.equal(settings.theme, "light");
  assert.equal(settings.deviceId, "this-device");
  assert.deepEqual(settings.packages, ["local-package"]);
  assert.deepEqual(settings.subagents.agentOverrides.worker, { model: "openai/gpt-6.1-terra", thinking: "medium", tools: ["read"] });
  assert.equal(settings.subagents.modelScope.agents, undefined);
});

test("unchanged choices do not rewrite runtime settings", t => {
  const fixture = setUp(t);
  applyModelChoices(fixture.agentDir);
  const before = statSync(join(fixture.agentDir, "settings.json"));
  applyModelChoices(fixture.agentDir);
  assert.equal(statSync(join(fixture.agentDir, "settings.json")).mtimeMs, before.mtimeMs);
});

test("invalid JSON fails without replacing existing settings", t => {
  const fixture = setUp(t);
  writeFileSync(join(fixture.agentDir, "settings.json"), '{"theme":"light"}');
  writeFileSync(join(fixture.agentDir, "model-choices.local.json"), "{");
  assert.throws(() => applyModelChoices(fixture.agentDir), /Invalid .*model-choices.local.json/);
  assert.equal(readFileSync(join(fixture.agentDir, "settings.json"), "utf8"), '{"theme":"light"}');
});

test("unqualified model IDs are rejected instead of matching another provider", t => {
  const fixture = setUp(t);
  fixture.local({ agents: { reviewer: { model: "gpt-6-luna" } } });
  assert.throws(() => loadModelChoices(fixture.agentDir), /agents.reviewer.model must be an exact provider\/model ID/);
});

test("unknown config keys are rejected instead of silently ignoring device choices", t => {
  const fixture = setUp(t);
  fixture.local({ provider: "openai-codex" });
  assert.throws(() => loadModelChoices(fixture.agentDir), /support only parent, defaultSubagent, agents, and supportedModels/);
});

test("invalid thinking levels fail before settings change", t => {
  const fixture = setUp(t);
  fixture.local({ parent: { thinking: "maximum" } });
  assert.throws(() => applyModelChoices(fixture.agentDir), /parent.thinking must be a Pi thinking level/);
});

test("an active Pi settings lock is not stolen", t => {
  const fixture = setUp(t);
  mkdirSync(join(fixture.agentDir, "settings.json.lock"));
  assert.throws(() => applyModelChoices(fixture.agentDir), /Cannot lock .*settings.json/);
});

test("the launcher applies choices before forwarding arguments and the working directory", t => {
  const fixture = setUp(t);
  fixture.local({ parent: { model: "openai-codex/gpt-6.1-sol" } });
  const result = spawnSync("/bin/bash", [wrapper, "--model", "openai/gpt-6-astra", "two words"], {
    cwd: fixture.root, env: envFor(fixture.agentDir, fakePi(fixture.root)), encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: ["--model", "openai/gpt-6-astra", "two words"], cwd: fixture.root });
  assert.equal(fixture.settings().defaultProvider, "openai-codex");
});

test("the launcher does not run Pi after invalid local configuration", t => {
  const fixture = setUp(t);
  fixture.local({ parent: { model: "not-qualified" } });
  const result = spawnSync("/bin/bash", [wrapper, "--version"], {
    env: envFor(fixture.agentDir, fakePi(fixture.root)), encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /parent.model/);
});

test("custom agent directories without the dotfiles config retain native behavior", t => {
  const fixture = setUp(t);
  const empty = join(fixture.root, "empty");
  mkdirSync(empty);
  const result = spawnSync("/bin/bash", [wrapper, "--version"], {
    env: envFor(empty, fakePi(fixture.root)), encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, ["--version"]);
});

test("jj drafting uses the configured reviewer model instead of a hardcoded provider", t => {
  const fixture = setUp(t);
  fixture.local({ agents: { reviewer: { model: "openai-codex/gpt-6-luna", thinking: "high" } } });
  const bin = fakePi(fixture.root);
  writeFileSync(join(bin, "jj"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const output = join(fixture.root, "output");
  const result = spawnSync("/bin/bash", [jjRunner, "commit", join(fixture.root, "prompt"), output], {
    cwd: fixture.root,
    env: { ...envFor(fixture.agentDir, bin), JJ_AI_BACKEND: "pi", JJ_AI_MODEL: "", JJ_COMMIT_MODEL: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")).args.slice(0, 2), ["--model", "openai-codex/gpt-6-luna:high"]);
});
