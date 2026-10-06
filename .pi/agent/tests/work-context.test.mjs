import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createJiti } from "../npm/node_modules/jiti/lib/jiti.mjs";

const hostRoot = join(dirname(realpathSync("/opt/homebrew/bin/pi")), "..", "libexec/lib/node_modules/@earendil-works/pi-coding-agent");
const hostRequire = createRequire(join(hostRoot, "package.json"));
const jiti = createJiti(import.meta.url, { alias: { typebox: hostRequire.resolve("typebox") } });
const workContext = await jiti.import("../extensions/work-context/index.ts", { default: true });
const { SNAPSHOT_EVENT, REQUEST_EVENT, SELECTION_ENTRY, parseGithubRepositoryUrl } = await jiti.import("../extensions/work-context/core.ts");
const { DefaultResourceLoader, ExtensionRunner, SessionManager, SettingsManager } = await import(pathToFileURL(join(hostRoot, "dist/index.js")));
const { createCodemodeToolDefinition } = await import(pathToFileURL(join(hostRoot, "dist/extensions/codemode/tool.js")));

const ok = stdout => ({ code: 0, killed: false, stdout, stderr: "" });
const absent = { code: 1, killed: false, stdout: "", stderr: "unavailable" };
const pr = (repo, number) => ({ url: `https://github.com/${repo}/pull/${number}`, repo, number });
const repoExec = ({ branch = "feature", revision = "abcdefgh", workspace = true } = {}) =>
  async (command, args) => {
    if (command === "jj" && args.includes("log")) return ok(revision);
    if (command === "jj" && args.includes("bbt")) return ok(`${branch}\nmain\n`);
    if (command === "jj" && args.includes("workspace")) return workspace ? ok("/repo") : absent;
    return absent;
  };

const setUp = (t, { cwd = "/work/repo", mode = "tui", exec = async () => absent, entries = [], persistenceError = false } = {}) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const emitter = new EventEmitter();
  const handlers = new Map();
  const snapshots = [];
  const calls = [];
  const persisted = [];
  const tools = new Map();
  let sessionId = "session-a";
  let branchEntries = entries;
  const events = {
    emit: (name, value) => emitter.emit(name, value),
    on: (name, handler) => { emitter.on(name, handler); return () => emitter.off(name, handler); },
  };
  events.on(SNAPSHOT_EVENT, snapshot => snapshots.push(snapshot));
  const ctx = { cwd, mode, sessionManager: { getSessionId: () => sessionId, getBranch: () => branchEntries } };
  workContext({
    events,
    on: (name, handler) => handlers.set(name, handler),
    registerTool: definition => tools.set(definition.name, definition),
    appendEntry: (customType, data) => {
      if (persistenceError) throw new Error("Persistence unavailable");
      const entry = { type: "custom", customType, data };
      persisted.push(entry);
      branchEntries = [...branchEntries, entry];
    },
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      assert.notEqual(command, "gh", "PR metadata must never invoke gh");
      return exec(command, args, options);
    },
  });
  t.after(() => {
    handlers.get("session_shutdown")();
    assert.equal(calls.filter(call => call.command === "gh").length, 0, "no lifecycle or tool update may invoke gh");
  });
  const emit = (name, event = {}) => handlers.get(name)(event, ctx);
  return {
    ctx, events, handlers, calls, snapshots, persisted,
    tool: (name = "work_context") => tools.get(name),
    start: () => emit("session_start"), emit,
    update: params => tools.get("work_context").execute("call", params, undefined, undefined, ctx),
    snapshot: () => snapshots.at(-1),
    flush: async () => { t.mock.timers.tick(150); await nextTurn(); },
    navigate: (id, entries, newCwd = cwd) => { sessionId = id; branchEntries = entries; ctx.cwd = newCwd; },
  };
};

test("defaults to the session cwd and synchronously answers only matching requests", t => {
  const f = setUp(t);
  f.start();
  assert.deepEqual(f.snapshot(), { version: 1, sessionId: "session-a", directories: [{ path: "/work/repo" }], pullRequests: [] });
  assert.equal(f.calls.length, 0, "discovery is not on the snapshot request path");
  f.events.emit(REQUEST_EVENT, { sessionId: "wrong" });
  assert.equal(f.snapshots.length, 1);
  f.events.emit(REQUEST_EVENT, { sessionId: "session-a" });
  assert.equal(f.snapshots.length, 2);
});

test("nonrepo directories and missing executables remain useful directory metadata", async t => {
  const f = setUp(t, { exec: async () => { throw new Error("ENOENT"); } });
  f.start();
  await f.flush();
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
  assert.deepEqual(f.snapshot().pullRequests, []);
});

test("annotates a jj workspace and first bbt bookmark without discovering PRs", async t => {
  const f = setUp(t, { exec: repoExec() });
  f.start();
  await f.flush();
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo", revision: "abcdefgh", bookmark: "feature", workspace: "jj-workspace" }]);
  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.ok(f.calls.filter(call => call.command === "jj").every(call => call.args.includes("--ignore-working-copy")));
  assert.equal(f.calls.filter(call => call.command === "gh").length, 0);
  assert.equal(f.persisted.length, 0, "automatic snapshots are not persisted");
});

test("git-only linked worktrees annotate their existing directory without a second list", async t => {
  const f = setUp(t, { exec: async (command, args) => {
    if (command === "git" && args[0] === "branch") return ok("git-feature\n");
    if (command === "git") return ok("/repo/.git/worktrees/other\n/repo/.git\n");
    return absent;
  } });
  f.start();
  await f.flush();
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo", bookmark: "git-feature", workspace: "git-worktree" }]);
});

test("ordinary git checkouts have no worktree annotation", async t => {
  const f = setUp(t, { exec: async (command, args) => {
    if (command === "git" && args[0] === "branch") return ok("feature");
    if (command === "git") return ok("/repo/.git\n/repo/.git\n");
    return absent;
  } });
  f.start();
  await f.flush();
  assert.equal(f.snapshot().directories[0].workspace, undefined);
});

test("canonicalizes relative, symlink and tilde paths without changing execution cwd", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-work-context-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "project"));
  symlinkSync(join(root, "project"), join(root, "alias"));
  const f = setUp(t, { cwd: root });
  f.start();
  await f.update({ directories: ["project", "alias", join(root, "project"), "~"] });
  assert.deepEqual(f.snapshot().directories, [{ path: join(root, "project") }, { path: realpathSync(homedir()) }]);
  assert.equal(f.ctx.cwd, root);
  assert.deepEqual(f.persisted[0], { type: "custom", customType: SELECTION_ENTRY, data: { version: 1, directories: [join(root, "project"), realpathSync(homedir())] } });
});

test("replaces the supplied PR list and retains omitted directories", async t => {
  const f = setUp(t);
  f.start();
  await f.update({ directories: ["/selected"], prs: ["https://github.com/owner/repo/pull/1"] });

  await f.update({ prs: ["https://github.com/other/repo/pull/2"] });

  assert.deepEqual(f.snapshot().directories, [{ path: "/selected" }]);
  assert.deepEqual(f.snapshot().pullRequests, [pr("other/repo", 2)]);
  assert.equal(f.ctx.cwd, "/work/repo");
});

test("repeating a canonical PR replacement does not persist another update", async t => {
  const f = setUp(t);
  f.start();
  await f.update({ prs: ["https://github.com/Owner/Repo/pull/1/"] });

  await f.update({ prs: ["https://github.com/owner/repo/pull/1"] });

  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 1)]);
  assert.equal(f.persisted.length, 1);
});

test("skips an invalid PR replacement without changing work context", async t => {
  const f = setUp(t);
  f.start();

  const result = await f.update({ prs: ["https://evil.test/owner/repo/pull/1"] });

  assert.match(result.content[0].text, /skipped/);
  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.equal(f.persisted.length, 0);
});

const executeScript = (f, code) => createCodemodeToolDefinition().execute("script", { code }, undefined, undefined, {
  ...f.ctx,
  tools: [f.tool()],
  executeTool: async (name, args) => ({
    toolCall: { id: "script/1" },
    isError: false,
    result: await f.tool(name).execute("script/1", args, undefined, undefined, f.ctx),
  }),
});

test("codemode sets PRs alongside existing script output without a separate model call", async t => {
  const f = setUp(t, { mode: "print" });
  f.start();

  const result = await executeScript(f, 'await tools.work_context({prs: ["https://github.com/owner/repo/pull/123"]}); text("existing work");');

  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 123)]);
  assert.ok(result.content.some(item => item.type === "text" && item.text === "existing work"));
  assert.ok(!result.content.some(item => item.type === "text" && item.text.includes("Script failed")));
  assert.equal(f.calls.length, 0);
});

test("a skipped PR update does not interrupt the existing codemode script", async t => {
  const f = setUp(t, { mode: "print" });
  f.start();

  const result = await executeScript(f, 'await tools.work_context({prs: ["not a PR URL"]}); text("existing work");');

  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.ok(result.content.some(item => item.type === "text" && item.text === "existing work"));
  assert.ok(!result.content.some(item => item.type === "text" && item.text.includes("Script failed")));
});

test("persistence failure skips atomically and does not interrupt codemode output", async t => {
  const f = setUp(t, { mode: "print", persistenceError: true });
  f.start();
  const result = await executeScript(f, 'const update = await tools.work_context({directories: ["/new"], prs: ["https://github.com/owner/repo/pull/1"]}); text(update); text("existing work");');
  assert.ok(result.content.some(item => item.type === "text" && item.text.includes("skipped")));
  assert.ok(result.content.some(item => item.type === "text" && item.text === "existing work"));
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.equal(f.persisted.length, 0);
});

test("overflowing replacement lists skip and allow later codemode output", async t => {
  const f = setUp(t, { mode: "print" });
  f.start();
  const result = await executeScript(f, 'const update = await tools.work_context({directories: ["/1", "/2", "/3", "/4", "/5", "/6", "/7", "/8", "/9"], prs: ["https://github.com/owner/repo/pull/1"]}); text(update); text("existing work");');
  assert.ok(result.content.some(item => item.type === "text" && item.text.includes("skipped")));
  assert.ok(result.content.some(item => item.type === "text" && item.text === "existing work"));
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.equal(f.persisted.length, 0);
});

test("only work_context is registered with two optional string-array fields", t => {
  const f = setUp(t);
  assert.equal(f.tool("addPR"), undefined);
  const schema = f.tool().parameters;
  assert.deepEqual(Object.keys(schema.properties), ["directories", "prs"]);
  assert.deepEqual(schema.required ?? [], []);
  assert.equal(schema.properties.directories.type, "array");
  assert.equal(schema.properties.prs.type, "array");
  assert.equal(schema.properties.directories.items.type, "string");
  assert.equal(schema.properties.prs.items.type, "string");
});

test("omitted fields and repeated empty replacements are persistence no-ops", async t => {
  const f = setUp(t);
  f.start();
  await f.update({});
  await f.update({ directories: [], prs: [] });
  assert.equal(f.persisted.length, 0);
  await f.update({ directories: ["/selected"], prs: ["https://github.com/owner/repo/pull/1"] });
  await f.update({});
  await f.update({ directories: ["/selected"] });
  assert.equal(f.persisted.length, 1);
  assert.deepEqual(f.snapshot().directories, [{ path: "/selected" }]);
  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 1)]);
});

test("explicit multiple-repo PRs deduplicate canonical URLs and omitted fields retain overrides", async t => {
  const f = setUp(t, { exec: repoExec() });
  f.start();
  await f.update({ directories: ["/one", "/two"], prs: ["https://github.com/Owner/Repo/pull/1/", "https://github.com/owner/repo/pull/1", "https://github.com/other/repo/pull/2"] });
  await f.update({ directories: ["/three"] });
  await f.flush();
  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 1), pr("other/repo", 2)]);
  assert.deepEqual(f.snapshot().directories.map(directory => directory.path), ["/three"]);
  assert.equal(f.calls.filter(call => call.command === "gh").length, 0);
});

test("empty PR override intentionally hides PRs while empty directories restores cwd", async t => {
  const f = setUp(t, { exec: repoExec() });
  f.start();
  await f.update({ directories: ["/elsewhere"], prs: [] });
  await f.update({ directories: [] });
  await f.flush();
  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.equal(f.snapshot().directories[0].path, "/work/repo");
  assert.deepEqual(f.persisted.at(-1).data, { version: 1 });
});

test("complete replacement lists switch tasks without append semantics", async t => {
  const f = setUp(t);
  f.start();
  await f.update({ directories: ["/old"], prs: ["https://github.com/owner/repo/pull/4"] });
  await f.update({ directories: ["/new"], prs: ["https://github.com/new/repo/pull/9"] });
  assert.deepEqual(f.snapshot().directories, [{ path: "/new" }]);
  assert.deepEqual(f.snapshot().pullRequests, [pr("new/repo", 9)]);
  await f.update({ directories: [], prs: [] });
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.deepEqual(f.persisted.at(-1).data, { version: 1 });
});

test("skips unsafe URLs and controls atomically without persisting partial directory changes", async t => {
  const f = setUp(t);
  f.start();
  assert.match((await f.update({ directories: ["/changed"], prs: ["https://github.com/owner/repo/pull/1\u001b]8;;bad"] })).content[0].text, /skipped/);
  assert.match((await f.update({ directories: ["/bad\npath"] })).content[0].text, /skipped/);
  assert.match((await f.update({ prs: ["https://evil.test/owner/repo/pull/1"] })).content[0].text, /skipped/);
  assert.match((await f.update({ prs: ["https://github.com/owner/repo/pull/1?secret=1"] })).content[0].text, /skipped/);
  assert.equal(f.persisted.length, 0);
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
});

test("skips overflowing directory and PR arrays even when invoked without host schema validation", async t => {
  const f = setUp(t);
  f.start();
  assert.match((await f.update({ directories: Array.from({ length: 9 }, (_, i) => `/repo${i}`) })).content[0].text, /skipped/);
  assert.match((await f.update({ prs: Array.from({ length: 17 }, (_, i) => `https://github.com/owner/repo/pull/${i + 1}`) })).content[0].text, /skipped/);
  assert.equal(f.persisted.length, 0);
});

test("malformed arrays skip atomically when called without host validation", async t => {
  const f = setUp(t);
  f.start();
  assert.match((await f.update({ directories: ["/partial"], prs: [123] })).content[0].text, /skipped/);
  assert.match((await f.update({ directories: null })).content[0].text, /skipped/);
  assert.match((await f.update({ prs: "https://github.com/owner/repo/pull/1" })).content[0].text, /skipped/);
  assert.equal(f.persisted.length, 0);
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
});

test("persisted selections normalize empty lists and ignore malformed entries atomically", t => {
  const f = setUp(t, { entries: [
    { type: "custom", customType: SELECTION_ENTRY, data: { version: 1, directories: [], prs: [] } },
    { type: "custom", customType: SELECTION_ENTRY, data: { version: 1, directories: ["/partial"], prs: null } },
  ] });
  f.start();
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.equal(f.persisted.length, 0);
});

test("resumes the last valid active-branch selection rather than unrelated entries", t => {
  const entries = [
    { type: "custom", customType: SELECTION_ENTRY, data: { version: 1, directories: ["/selected"], prs: ["https://github.com/owner/repo/pull/8"] } },
    { type: "custom", customType: "other", data: { version: 1, directories: ["/unrelated"] } },
    { type: "custom", customType: SELECTION_ENTRY, data: { version: 2, directories: ["/unsupported"] } },
  ];
  const f = setUp(t, { entries });
  f.start();
  assert.deepEqual(f.snapshot().directories, [{ path: "/selected" }]);
  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 8)]);
  assert.equal(f.persisted.length, 0);
});

test("tree navigation reconstructs selection and session replacement uses fresh cwd", async t => {
  const f = setUp(t);
  f.start();
  await f.update({ directories: ["/selected"], prs: ["https://github.com/owner/repo/pull/1"] });
  f.navigate("session-a", []);
  f.emit("session_tree");
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
  assert.deepEqual(f.snapshot().pullRequests, []);
  f.emit("session_shutdown");
  f.navigate("session-b", [], "/fresh/cwd");
  f.start();
  assert.equal(f.snapshot().sessionId, "session-b");
  assert.deepEqual(f.snapshot().directories, [{ path: "/fresh/cwd" }]);
});

test("late discovery cannot overwrite a new session", async t => {
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const f = setUp(t, { exec: async (_command, _args, options) => options.cwd === "/work/repo" ? deferred : absent });
  f.start();
  await f.flush();
  f.emit("session_shutdown");
  f.navigate("session-b", [], "/fresh");
  f.start();
  await f.flush();
  release(ok("old-revision"));
  await nextTurn();
  assert.equal(f.snapshot().sessionId, "session-b");
  assert.deepEqual(f.snapshot().directories, [{ path: "/fresh" }]);
});

test("late local discovery cannot overwrite a newer pushed PR selection", async t => {
  let release;
  const local = new Promise(resolve => { release = resolve; });
  const f = setUp(t, { exec: async () => local });
  f.start();
  await f.flush();
  await f.update({ prs: ["https://github.com/new/repo/pull/7"] });
  release(ok("old-revision"));
  await nextTurn();
  assert.deepEqual(f.snapshot().pullRequests, [pr("new/repo", 7)]);
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo" }]);
});

test("bookmark changes retain pushed PRs until an explicit update", async t => {
  let branch = "first";
  const f = setUp(t, { exec: (command, args) => repoExec({ branch })(command, args) });
  f.start();
  await f.update({ prs: ["https://github.com/owner/repo/pull/1"] });
  await f.flush();
  branch = "second";
  f.emit("tool_execution_end");
  await f.flush();
  assert.equal(f.snapshot().directories[0].bookmark, "second");
  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 1)]);
  assert.equal(f.calls.filter(call => call.command === "gh").length, 0);
  await f.update({ prs: [] });
  assert.deepEqual(f.snapshot().pullRequests, []);
});

test("tool completion and settled metadata refreshes are debounced with zero gh calls", async t => {
  const f = setUp(t, { exec: repoExec() });
  f.start();
  await f.flush();
  f.emit("tool_execution_end");
  f.emit("tool_execution_end");
  f.emit("agent_settled");
  await f.flush();
  assert.equal(f.calls.filter(call => call.command === "gh").length, 0);
  assert.equal(f.calls.filter(call => call.command === "jj" && call.args.includes("log")).length, 2);
});

test("multiple directories coexist with pushed PRs retaining full repository identity", async t => {
  const f = setUp(t, { exec: repoExec() });
  f.start();
  await f.update({ directories: ["/one", "/two"], prs: ["https://github.com/one/repo/pull/1", "https://github.com/two/repo/pull/1"] });
  await f.flush();
  assert.equal(f.snapshot().directories.length, 2);
  assert.deepEqual(f.snapshot().pullRequests, [pr("one/repo", 1), pr("two/repo", 1)]);
});

test("print mode persists tool updates without background network", async t => {
  const f = setUp(t, { mode: "print", exec: repoExec() });
  f.start();
  await f.flush();
  assert.equal(f.calls.length, 0);
  await f.update({ directories: ["/other"], prs: ["https://github.com/owner/repo/pull/5"] });
  await f.flush();
  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 5)]);
  assert.equal(f.calls.filter(call => call.command === "gh").length, 0);
  assert.equal(f.persisted.length, 1);
});

test("shutdown cancels timers and removes snapshot request subscriptions", async t => {
  const f = setUp(t, { exec: repoExec() });
  f.start();
  f.emit("session_shutdown");
  await f.flush();
  assert.equal(f.calls.length, 0);
  f.events.emit(REQUEST_EVENT, { sessionId: "session-a" });
  assert.equal(f.snapshots.length, 1);
});

test("stable short instructions preserve structured and forced child prompts without state injection", t => {
  const f = setUp(t);
  const event = { systemPromptOptions: { sections: { role: "Worker role" }, forceSystemPrompt: "Role\nChild boundary: no delegation." } };
  f.emit("before_agent_start", event);
  const first = event.systemPromptOptions.forceSystemPrompt;
  f.emit("before_agent_start", event);
  assert.equal(event.systemPromptOptions.sections.role, "Worker role");
  assert.equal(event.systemPromptOptions.forceSystemPrompt, first);
  assert.ok(first.startsWith("Role\nChild boundary: no delegation."));
  assert.equal(first.split("<!-- pi-work-context:start -->").length, 2);
  assert.ok(event.systemPromptOptions.sections.work_context.length < 300);
  assert.ok(first.includes("never investigate, retry, or ask permission"));
  assert.ok(!first.includes("/work/repo"));
});

test("instructions tie context updates to work changes using complete known lists", t => {
  const f = setUp(t);
  const event = { systemPromptOptions: { sections: {} } };

  f.emit("before_agent_start", event);

  const instruction = event.systemPromptOptions.sections.work_context;
  assert.ok(instruction.includes("switching directories, starting PR work, or finishing work"));
  assert.ok(instruction.includes("Piggyback tools.work_context({...}) into existing codemode scripts"));
  assert.ok(instruction.includes("supplied lists must be complete"));
  assert.ok(instruction.includes("Use known paths/URLs only"));
  assert.ok(instruction.includes("Execution cwd is unchanged"));
});

test("old-session tool contexts cannot restore stale state after a replacement", async t => {
  const f = setUp(t);
  f.start();
  const oldCtx = { ...f.ctx, sessionManager: { getSessionId: () => "session-a", getBranch: () => [] } };
  f.emit("session_shutdown");
  f.navigate("session-b", [], "/fresh");
  f.start();
  const result = await f.tool().execute("old-call", { directories: ["/stale"] }, undefined, undefined, oldCtx);
  assert.match(result.content[0].text, /ignored/);
  assert.equal(f.snapshot().sessionId, "session-b");
  assert.deepEqual(f.snapshot().directories, [{ path: "/fresh" }]);
  assert.equal(f.persisted.length, 0);
});

test("transient metadata failures keep useful directory metadata", async t => {
  let fail = false;
  const local = repoExec();
  const f = setUp(t, { exec: (command, args) => fail ? absent : local(command, args) });
  f.start();
  await f.flush();
  fail = true;
  f.emit("agent_settled");
  await f.flush();
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo", revision: "abcdefgh", bookmark: "feature", workspace: "jj-workspace" }]);
});

test("an empty current bookmark preserves pushed PRs rather than inferring associations", async t => {
  let branch = "feature";
  const f = setUp(t, { exec: (command, args) => repoExec({ branch })(command, args) });
  f.start();
  await f.update({ prs: ["https://github.com/owner/repo/pull/1"] });
  await f.flush();
  branch = "";
  f.emit("tool_execution_end");
  await f.flush();
  assert.equal(f.snapshot().directories[0].bookmark, undefined);
  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 1)]);
});

test("rpc mode permits selection and persistence without network discovery", async t => {
  const f = setUp(t, { mode: "rpc", exec: repoExec() });
  f.start();
  await f.update({ directories: ["/rpc-work"] });
  await f.flush();
  assert.equal(f.snapshot().directories[0].path, "/rpc-work");
  assert.equal(f.snapshot().directories[0].revision, "abcdefgh");
  assert.deepEqual(f.snapshot().pullRequests, []);
  assert.equal(f.calls.filter(call => call.command === "gh").length, 0);
  assert.equal(f.persisted.length, 1);
});

test("installed Pi loads the tool and renders stable instructions in forced prompts", async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-work-context-host-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const boundary = "Read-only role\nChild boundary: no parent authority.";
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir: root, settingsManager: SettingsManager.inMemory(),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [
      pi => { pi.on("before_agent_start", event => ({ systemPrompt: event.systemPromptOptions.forceSystemPrompt ?? boundary })); },
      workContext,
    ],
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, SessionManager.inMemory(root), {});
  runner.setUIContext(undefined, "print");
  runner.onError(error => assert.fail(error.error));
  t.after(() => runner.emit({ type: "session_shutdown", reason: "reload" }));
  await runner.emit({ type: "session_start", reason: "startup" });
  assert.equal(runner.getToolDefinition("work_context").executionMode, "sequential");
  assert.equal(runner.getToolDefinition("work_context").exposure, "codemode");
  assert.equal(runner.getToolDefinition("addPR"), undefined);
  const first = await runner.emitBeforeAgentStart("task", undefined, { cwd: root });
  const second = await runner.emitBeforeAgentStart("task", undefined, first.systemPromptOptions);
  assert.equal(second.systemPromptOptions.forceSystemPrompt, first.systemPromptOptions.forceSystemPrompt);
  assert.ok(second.systemPromptOptions.forceSystemPrompt.startsWith(boundary));
  assert.ok(second.systemPromptOptions.forceSystemPrompt.includes("Piggyback tools.work_context({...}) into existing codemode scripts"));
});

test("repository parser canonicalizes HTTPS and SSH clone spellings", () => {
  const expected = { url: "https://github.com/owner/repo", repo: "owner/repo" };
  assert.deepEqual(parseGithubRepositoryUrl("https://github.com/Owner/Repo.git/"), expected);
  assert.deepEqual(parseGithubRepositoryUrl("https://github.com/owner/repo"), expected);
  assert.deepEqual(parseGithubRepositoryUrl("git@github.com:Owner/Repo.git"), expected);
  assert.deepEqual(parseGithubRepositoryUrl("ssh://git@github.com/Owner/Repo.git"), expected);
  assert.deepEqual(parseGithubRepositoryUrl("ssh://git@github.com:22/Owner/Repo.git"), expected);
});

test("repository parser rejects secrets, unsafe paths and terminal controls", () => {
  assert.equal(parseGithubRepositoryUrl("https://token@github.com/owner/repo"), undefined);
  assert.equal(parseGithubRepositoryUrl("https://github.com.evil.test/owner/repo"), undefined);
  assert.equal(parseGithubRepositoryUrl("http://github.com/owner/repo"), undefined);
  assert.equal(parseGithubRepositoryUrl("https://github.com/owner/repo?token=private"), undefined);
  assert.equal(parseGithubRepositoryUrl("https://github.com/owner/repo#fragment"), undefined);
  assert.equal(parseGithubRepositoryUrl("https://github.com/../repo"), undefined);
  assert.equal(parseGithubRepositoryUrl("https://github.com/owner/...git"), undefined);
  assert.equal(parseGithubRepositoryUrl("https://github.com/owner/%2e%2e"), undefined);
  assert.equal(parseGithubRepositoryUrl("https://github.com/owner/repo/pull/1"), undefined);
  assert.equal(parseGithubRepositoryUrl("ssh://user:private@github.com/owner/repo"), undefined);
  assert.equal(parseGithubRepositoryUrl("git@github.com:owner/repo\u001b"), undefined);
  assert.equal(parseGithubRepositoryUrl(`https://github.com/owner/${"x".repeat(1024)}`), undefined);
  assert.equal(parseGithubRepositoryUrl(null), undefined);
});

test("jj directories enrich snapshots from all local remotes without persisting enrichment", async t => {
  const local = repoExec();
  const f = setUp(t, { exec: (command, args, options) => {
    if (command === "jj" && args.includes("remote")) return ok(options.cwd === "/one"
      ? "origin https://github.com/Owner/Repo.git\nupstream git@github.com:owner/repo.git\nfork ssh://git@github.com/Other/Repo.git\n"
      : "origin https://github.com/owner/repo\n");
    return local(command, args);
  } });
  f.start();
  await f.update({ directories: ["/one", "/two"], prs: ["https://github.com/owner/repo/pull/2"] });
  await f.flush();
  assert.deepEqual(f.snapshot().directories[0].githubUrls, ["https://github.com/owner/repo", "https://github.com/other/repo"]);
  assert.deepEqual(f.snapshot().directories[1].githubUrls, ["https://github.com/owner/repo"]);
  assert.deepEqual(f.snapshot().pullRequests, [pr("owner/repo", 2)]);
  assert.deepEqual(f.persisted[0].data, { version: 1, directories: ["/one", "/two"], prs: ["https://github.com/owner/repo/pull/2"] });
  assert.equal(f.persisted.length, 1);
  assert.deepEqual(f.calls.find(call => call.args.includes("remote")).args, ["--ignore-working-copy", "--no-pager", "git", "remote", "list"]);
  assert.equal(f.calls.filter(call => call.command === "git").length, 0, "recognized jj workspaces use jj local metadata");
});

test("git-only directories deduplicate fetch, push and named remote spellings", async t => {
  const f = setUp(t, { exec: async (command, args) => {
    if (command !== "git") return absent;
    if (args[0] === "branch") return ok("feature\n");
    if (args[0] === "rev-parse") return ok("/repo/.git\n/repo/.git\n");
    if (args[0] === "remote") return ok("origin\thttps://github.com/Owner/Repo.git (fetch)\norigin\tgit@github.com:owner/repo.git (push)\nupstream\tssh://git@github.com/Other/Repo.git (fetch)\n");
    return absent;
  } });
  f.start();
  await f.flush();
  assert.deepEqual(f.snapshot().directories, [{ path: "/work/repo", bookmark: "feature", workspace: undefined, githubUrls: ["https://github.com/owner/repo", "https://github.com/other/repo"] }]);
  assert.deepEqual(f.calls.find(call => call.command === "git" && call.args[0] === "remote").args, ["remote", "-v"]);
});

test("unsupported and unsafe local remotes do not enter display snapshots", async t => {
  const local = repoExec();
  const f = setUp(t, { exec: (command, args) => command === "jj" && args.includes("remote")
    ? ok("origin https://gitlab.com/owner/repo.git\nsecret https://private@github.com/owner/repo.git\nquery https://github.com/owner/repo?private=1\nunsafe git@github.com:owner/repo\u001b\n")
    : local(command, args) });
  f.start();
  await f.flush();
  assert.equal(Object.hasOwn(f.snapshot().directories[0], "githubUrls"), false);
});

test("transient local remote failures retain URLs and successful removal clears them", async t => {
  let remotes = ok("origin git@github.com:owner/repo.git\n");
  const local = repoExec();
  const f = setUp(t, { exec: (command, args) => command === "jj" && args.includes("remote") ? remotes : local(command, args) });
  f.start();
  await f.flush();
  remotes = absent;
  f.emit("agent_settled");
  await f.flush();
  assert.deepEqual(f.snapshot().directories[0].githubUrls, ["https://github.com/owner/repo"]);
  remotes = ok("");
  f.emit("agent_settled");
  await f.flush();
  assert.equal(Object.hasOwn(f.snapshot().directories[0], "githubUrls"), false);
  assert.equal(f.snapshot().directories[0].bookmark, "feature");
});

test("local remote discovery bounds repository count and oversized command output", async t => {
  let remotes = ok(Array.from({ length: 20 }, (_, i) => `remote${i} https://github.com/owner/repo${i}.git`).join("\n"));
  const local = repoExec();
  const f = setUp(t, { exec: (command, args) => command === "jj" && args.includes("remote") ? remotes : local(command, args) });
  f.start();
  await f.flush();
  assert.equal(f.snapshot().directories[0].githubUrls.length, 16);
  assert.equal(f.snapshot().directories[0].githubUrls.at(-1), "https://github.com/owner/repo15");
  remotes = ok("x".repeat(64_001));
  f.emit("agent_settled");
  await f.flush();
  assert.equal(f.snapshot().directories[0].githubUrls.length, 16);
});

test("provider reads real git-only local remotes without contacting GitHub", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-work-context-git-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", root], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["remote", "add", "origin", "git@github.com:Owner/Repo.git"], { cwd: root, encoding: "utf8" }).status, 0);
  const f = setUp(t, { cwd: root, exec: async (command, args, options) => {
    if (command === "jj") return absent;
    const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", timeout: options.timeout });
    return { code: result.status, killed: !!result.error, stdout: result.stdout ?? "", stderr: "" };
  } });
  f.start();
  await f.flush();
  assert.deepEqual(f.snapshot().directories[0].githubUrls, ["https://github.com/owner/repo"]);
});

test("provider reads real non-colocated jj local remotes without a git checkout", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-work-context-jj-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync("jj", ["git", "init", "--no-colocate", root], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("jj", ["git", "remote", "add", "origin", "ssh://git@github.com/Owner/Repo.git"], { cwd: root, encoding: "utf8" }).status, 0);
  const f = setUp(t, { cwd: root, exec: async (command, args, options) => {
    const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", timeout: options.timeout });
    return { code: result.status, killed: !!result.error, stdout: result.stdout ?? "", stderr: "" };
  } });
  f.start();
  await f.flush();
  assert.deepEqual(f.snapshot().directories[0].githubUrls, ["https://github.com/owner/repo"]);
  assert.equal(f.snapshot().directories[0].workspace, "jj-workspace");
  assert.equal(f.calls.filter(call => call.command === "git").length, 0);
});
