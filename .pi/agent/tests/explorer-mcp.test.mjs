import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

// Like the other SDK tests, use the installed Pi without installing workspace packages.
const piPackageRoot = join(dirname(realpathSync("/opt/homebrew/bin/pi")), "..", "libexec", "lib", "node_modules", "@earendil-works", "pi-coding-agent");
const { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createAgentSession, createCodemodeExtension } = await import(pathToFileURL(join(piPackageRoot, "dist", "index.js")));
const { InMemoryCredentialStore, fauxProvider, fauxAssistantMessage, fauxToolCall } = await import(pathToFileURL(join(piPackageRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js")));
const { discoverAgents } = await import("/Users/creston/.pi/agent/npm/node_modules/pi-subagents/src/agents/agents.js");

const childExtensionFixture = t => {
  const root = mkdtempSync(join(tmpdir(), "pi-explorer-mcp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "child-extensions"));
  const shim = join(root, "child-extensions", "explorer-mcp.ts");
  copyFileSync(new URL("../child-extensions/explorer-mcp.ts", import.meta.url), shim);
  return { root, shim };
};

test("explicit child MCP shim loads native MCP alongside codemode without server selectors", async t => {
  const { root, shim } = childExtensionFixture(t);
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [shim],
    extensionFactories: [{ name: "codemode", factory: createCodemodeExtension(), replaceable: true }],
  });

  // Loading factories must not connect servers; no session_start is emitted.
  await loader.reload();
  const loaded = loader.getExtensions();

  assert.deepEqual(loaded.errors, []);
  assert.ok(loaded.extensions.some(extension => extension.commands.has("mcp")), "native MCP command must be registered");
  assert.ok(loaded.extensions.some(extension => extension.tools.has("codemode")), "codemode must be registered");
});

test("parent extension discovery does not load the child-only MCP shim", async t => {
  const { root } = childExtensionFixture(t);
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: SettingsManager.inMemory(),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });

  await loader.reload();

  assert.deepEqual(loader.getExtensions().errors, []);
  assert.deepEqual(loader.getExtensions().extensions, []);
});

const runtimeExplorer = async (t, tools) => {
  const { root, shim } = childExtensionFixture(t);
  // Native MCP reads the process agent directory. Isolate it before session_start
  // so binding this session never reads real MCP configuration or credentials.
  t.mock.property(process, "env", { ...process.env, PI_CODING_AGENT_DIR: root });
  mkdirSync(join(root, ".agents"));
  copyFileSync(new URL("../../../.agents/explorer.md", import.meta.url), join(root, ".agents", "explorer.md"));
  const { agents, agentDiagnostics } = discoverAgents(root, "project", undefined, { globalNpmRoot: null });
  const explorer = agents.find(agent => agent.name === "explorer" && agent.filePath === join(root, ".agents", "explorer.md"));
  assert.ok(explorer, JSON.stringify(agentDiagnostics));
  assert.equal(explorer.tools, undefined, "explorer must not strictly filter dynamic MCP tools");
  assert.deepEqual(explorer.excludeTools, ["bash", "powershell", "edit", "write", "subagent"]);
  const settingsManager = SettingsManager.inMemory();
  let api;
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [shim],
    extensionFactories: [
      { name: "codemode", factory: createCodemodeExtension(), replaceable: true },
      pi => { api = pi; },
    ],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  const faux = fauxProvider();
  modelRuntime.registerNativeProvider(faux.provider);
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime,
    model: faux.getModel(),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    settingsManager,
    tools,
    excludeTools: explorer.excludeTools,
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  return { session, api, faux };
};

const fixtureTool = (name, exposure = "direct") => ({
  name,
  label: name,
  description: "Look up an isolated fixture answer",
  namespace: { name: "fixture", description: "Isolated MCP fixture" },
  annotations: { readOnlyHint: true },
  exposure,
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => ({ content: [{ type: "text", text: "fixture answer" }], details: undefined }),
});

test("explorer exclusions retain dynamically registered MCP tools discoverable and callable through codemode", async t => {
  const { session, api, faux } = await runtimeExplorer(t);
  // Register after binding, like a server whose tools arrive asynchronously.
  api.registerTool(fixtureTool("mcp__fixture__lookup", "codemode"));
  api.registerTool(fixtureTool("subagent"));
  api.registerTool(fixtureTool("web_search"));
  api.registerTool(fixtureTool("fetch_content"));
  api.registerTool(fixtureTool("get_search_content"));
  api.registerTool(fixtureTool("source_check"));

  assert.ok(session.getCallableToolNames().includes("mcp__fixture__lookup"));
  assert.ok(!session.getActiveToolNames().includes("mcp__fixture__lookup"), "MCP fixture remains codemode-only");
  assert.ok(session.getActiveToolNames().includes("read"));
  assert.ok(session.getActiveToolNames().includes("grep"));
  assert.ok(session.getActiveToolNames().includes("find"));
  assert.ok(session.getActiveToolNames().includes("ls"));
  assert.ok(session.getActiveToolNames().includes("codemode"));
  assert.ok(session.getCallableToolNames().includes("web_search"));
  assert.ok(session.getCallableToolNames().includes("fetch_content"));
  assert.ok(session.getCallableToolNames().includes("get_search_content"));
  assert.ok(session.getCallableToolNames().includes("source_check"));
  assert.equal(session.getToolDefinition("bash"), undefined);
  assert.equal(session.getToolDefinition("powershell"), undefined);
  assert.equal(session.getToolDefinition("edit"), undefined);
  assert.equal(session.getToolDefinition("write"), undefined);
  assert.equal(session.getToolDefinition("subagent"), undefined);

  // A local scripted provider issues the call through the actual SDK turn and
  // nested tool pipeline. No provider service or MCP server is contacted.
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("codemode", {
      code: 'const matches = await searchTools("fixture lookup"); text(matches); text(await describeTool("mcp__fixture__lookup")); text(await tools.mcp__fixture__lookup({}));',
    }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done"),
  ]);
  await session.prompt("Read the isolated fixture through codemode.");
  const result = session.messages.find(message => message.role === "toolResult" && message.toolName === "codemode");
  assert.ok(result, "the SDK turn must produce a codemode tool result");
  const output = result.content.map(block => block.text ?? "").join("\n");
  assert.match(output, /mcp__fixture__lookup/, "search/describe must discover the dynamically registered tool");
  assert.match(output, /fixture answer/, "codemode must call the registered fixture through the SDK pipeline");
  assert.ok(!result.isError, output);
});

test("SDK strict tools allowlist filters out dynamically registered MCP tools", async t => {
  const { session, api } = await runtimeExplorer(t, ["read", "grep", "find", "ls", "codemode"]);

  api.registerTool(fixtureTool("mcp__fixture__lookup", "codemode"));

  assert.equal(session.getToolDefinition("mcp__fixture__lookup"), undefined);
  assert.ok(!session.getCallableToolNames().includes("mcp__fixture__lookup"));
});
