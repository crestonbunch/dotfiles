import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import personalRules, { loadPersonalRules } from "../extensions/personal-rules.ts";

const piPackageRoot = join(dirname(realpathSync("/opt/homebrew/bin/pi")), "..", "libexec", "lib", "node_modules", "@earendil-works", "pi-coding-agent");
const { DefaultResourceLoader, ExtensionRunner, ModelRuntime, SessionManager, SettingsManager, createAgentSession } = await import(pathToFileURL(join(piPackageRoot, "dist", "index.js")));
const { InMemoryCredentialStore, fauxProvider, fauxAssistantMessage, getCurrentSystemPrompt } = await import(pathToFileURL(join(piPackageRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js")));

const forcedPromptRunner = async (t, root, rulesDir) => {
  let rendered;
  const boundary = "Worker role preamble\n\nChild boundary: do not delegate.\n";
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      pi => { pi.on("before_agent_start", event => ({ systemPrompt: event.systemPromptOptions.forceSystemPrompt ?? boundary })); },
      pi => { personalRules(pi, rulesDir); },
      pi => { pi.on("before_agent_start", event => { rendered = event.systemPrompt; }); },
    ],
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, SessionManager.inMemory(root), {});
  runner.onError(error => assert.fail(error.error));
  await runner.emit({ type: "session_start" });
  return { runner, boundary, renderedPrompt: () => rendered };
};

const rulesDirFor = t => {
  const root = mkdtempSync(join(tmpdir(), "pi-personal-rules-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rulesDir = join(root, ".agents", "rules", "personal");
  mkdirSync(rulesDir, { recursive: true });
  return { root, rulesDir };
};

test("loads and injects the repository task execution contract", t => {
  const { rulesDir } = rulesDirFor(t);
  const contract = readFileSync(new URL("../../../.agents/rules/personal/task-execution.md", import.meta.url), "utf8");
  writeFileSync(join(rulesDir, "task-execution.md"), contract);
  const content = contract.slice(contract.indexOf("\n---\n") + 5).trim();
  const loaded = loadPersonalRules(rulesDir);
  assert.equal(loaded, `### task-execution.md\n${content}`);
  assert.ok(content.length > 0, "the shared contract must not be empty");
  const handlers = new Map();
  personalRules({ on: (name, callback) => { handlers.set(name, callback); }, registerCommand: () => {} }, rulesDir);
  const event = { systemPromptOptions: { sections: {} } };

  handlers.get("session_start")();
  handlers.get("before_agent_start")(event);

  assert.equal(event.systemPromptOptions.sections.personal_rules, `## Personal rules\n\n${loaded}`);
});

test("loads only always-applied personal rules in filename order", t => {
  const { root, rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "b.md"), "---\nalwaysApply: true\n---\n# B\nB rule\n");
  writeFileSync(join(rulesDir, "a.md"), "---\ndescription: A\nalwaysApply: true\n---\n# A\nA rule\n");
  writeFileSync(join(rulesDir, "optional.md"), "---\nalwaysApply: false\n---\n# Optional\n");
  writeFileSync(join(rulesDir, "no-frontmatter.md"), "# Not a rule\n");
  mkdirSync(join(root, ".claude", "rules"), { recursive: true });
  mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
  writeFileSync(join(root, ".claude", "rules", "other.md"), "---\nalwaysApply: true\n---\n# Claude\n");
  writeFileSync(join(root, ".cursor", "rules", "other.md"), "---\nalwaysApply: true\n---\n# Cursor\n");

  assert.equal(loadPersonalRules(rulesDir), "### a.md\n# A\nA rule\n\n### b.md\n# B\nB rule");
});

test("adds personal rules to the system prompt section on agent start", t => {
  const { rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# Routing\nDelegate work.\n");
  const handlers = new Map();
  personalRules({ on: (name, callback) => { handlers.set(name, callback); }, registerCommand: () => {} }, rulesDir);
  const event = { systemPromptOptions: { sections: {} } };

  handlers.get("session_start")();
  handlers.get("before_agent_start")(event);

  assert.equal(event.systemPromptOptions.sections.personal_rules, "## Personal rules\n\n### routing.md\n# Routing\nDelegate work.");
});

test("removes stale personal rules when they are no longer present", t => {
  const { rulesDir } = rulesDirFor(t);
  const handlers = new Map();
  personalRules({ on: (name, callback) => { handlers.set(name, callback); }, registerCommand: () => {} }, rulesDir);
  const event = { systemPromptOptions: { sections: { personal_rules: "stale" } } };

  handlers.get("session_start")();
  handlers.get("before_agent_start")(event);

  assert.equal(event.systemPromptOptions.sections.personal_rules, undefined);
});

test("keeps session rules until session start reloads them", t => {
  const { rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# Old\n");
  const handlers = new Map();
  personalRules({ on: (name, callback) => { handlers.set(name, callback); }, registerCommand: () => {} }, rulesDir);
  handlers.get("session_start")();
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# New\n");
  const beforeReload = { systemPromptOptions: { sections: {} } };
  handlers.get("before_agent_start")(beforeReload);
  assert.equal(beforeReload.systemPromptOptions.sections.personal_rules, "## Personal rules\n\n### routing.md\n# Old");

  handlers.get("session_start")();
  const afterReload = { systemPromptOptions: { sections: {} } };
  handlers.get("before_agent_start")(afterReload);
  assert.equal(afterReload.systemPromptOptions.sections.personal_rules, "## Personal rules\n\n### routing.md\n# New");
});

test("/rules reports cached names and size", t => {
  const { rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# Rule\n");
  const handlers = new Map();
  let command;
  let notification;
  personalRules({
    on: (name, callback) => { handlers.set(name, callback); },
    registerCommand: (name, definition) => { assert.equal(name, "rules"); command = definition; },
  }, rulesDir);
  handlers.get("session_start")();
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\n# Changed\n");

  command.handler("", { ui: { notify: text => { notification = text; } } });

  assert.equal(notification, "1 personal rules (6 bytes):\n- routing.md");
});

test("forced child prompts render current rules once while preserving role and boundaries", async t => {
  const { root, rulesDir } = rulesDirFor(t);
  const contract = readFileSync(new URL("../../../.agents/rules/personal/task-execution.md", import.meta.url), "utf8");
  writeFileSync(join(rulesDir, "task-execution.md"), contract);
  const { runner, boundary, renderedPrompt } = await forcedPromptRunner(t, root, rulesDir);

  const first = await runner.emitBeforeAgentStart("task", undefined, { cwd: root });
  const repeated = await runner.emitBeforeAgentStart("task", undefined, first.systemPromptOptions);

  assert.equal(repeated.systemPromptOptions.forceSystemPrompt, first.systemPromptOptions.forceSystemPrompt);
  assert.ok(renderedPrompt().startsWith(boundary), "forced child preamble and boundary must be preserved verbatim");
  assert.ok(renderedPrompt().includes(loadPersonalRules(rulesDir)), "rules must appear in rendered text, not only saved sections");
  assert.equal(renderedPrompt().split("## Personal rules").length, 2, "rendered prompt must contain exactly one rules block");
});

test("forced child prompts replace stale rule content after session reload", async t => {
  const { root, rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\nOld content\n");
  const { runner, renderedPrompt } = await forcedPromptRunner(t, root, rulesDir);
  const first = await runner.emitBeforeAgentStart("task", undefined, { cwd: root });
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\nNew content\n");

  await runner.emit({ type: "session_start" });
  await runner.emitBeforeAgentStart("task", undefined, first.systemPromptOptions);

  assert.ok(renderedPrompt().includes("New content"));
  assert.ok(!renderedPrompt().includes("Old content"));
  assert.equal(renderedPrompt().split("## Personal rules").length, 2);
});

test("empty rules remove only the owned block from a forced child prompt", async t => {
  const { root, rulesDir } = rulesDirFor(t);
  writeFileSync(join(rulesDir, "routing.md"), "---\nalwaysApply: true\n---\nCurrent content\n");
  const { runner, boundary, renderedPrompt } = await forcedPromptRunner(t, root, rulesDir);
  const first = await runner.emitBeforeAgentStart("task", undefined, { cwd: root });
  rmSync(join(rulesDir, "routing.md"));

  await runner.emit({ type: "session_start" });
  const empty = await runner.emitBeforeAgentStart("task", undefined, first.systemPromptOptions);

  assert.equal(renderedPrompt(), boundary);
  assert.equal(empty.systemPromptOptions.sections.personal_rules, undefined);
});

test("the SDK provider receives the shared contract in the forced child prompt", async t => {
  const { root, rulesDir } = rulesDirFor(t);
  const contract = readFileSync(new URL("../../../.agents/rules/personal/task-execution.md", import.meta.url), "utf8");
  writeFileSync(join(rulesDir, "task-execution.md"), contract);
  const boundary = "Read-only child role\n\nChild boundary: no parent authority.";
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      pi => { pi.on("before_agent_start", () => ({ systemPrompt: boundary })); },
      pi => { personalRules(pi, rulesDir); },
    ],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  const faux = fauxProvider();
  modelRuntime.registerNativeProvider(faux.provider);
  let providerPrompt;
  faux.setResponses([context => {
    providerPrompt = getCurrentSystemPrompt(context.messages);
    return fauxAssistantMessage("Done");
  }]);
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime,
    model: faux.getModel(),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    settingsManager,
    noTools: "all",
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});

  await session.prompt("Check the forced prompt without a remote provider.");

  assert.ok(providerPrompt.startsWith(boundary), "the provider must retain the forced role and child boundary");
  assert.ok(providerPrompt.includes(loadPersonalRules(rulesDir)), "the provider must see the actual shared contract");
  assert.equal(providerPrompt.split("## Personal rules").length, 2);
});
