import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import { test } from "node:test";
import { createJiti } from "../npm/node_modules/jiti/lib/jiti.mjs";

const piPackageRoot = join(
  dirname(realpathSync("/opt/homebrew/bin/pi")),
  "..",
  "libexec",
  "lib",
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
);
const hostRequire = createRequire(join(piPackageRoot, "package.json"));
const jiti = createJiti(import.meta.url, { alias: {
  "@earendil-works/pi-tui": hostRequire.resolve("@earendil-works/pi-tui"),
} });
const { visibleWidth } = await jiti.import("@earendil-works/pi-tui");
const { SNAPSHOT_EVENT, REQUEST_EVENT } = await jiti.import("../extensions/work-context/core.ts");
const claudeFooter = await jiti.import("../extensions/claude-footer.ts", {
  default: true,
});

const makeEvents = () => {
  const emitter = new EventEmitter();
  return {
    emit: (name, value) => emitter.emit(name, value),
    listenerCount: name => emitter.listenerCount(name),
    on: (name, handler) => {
      emitter.on(name, handler);
      return () => emitter.off(name, handler);
    },
  };
};

const setUp = (t, { respond, snapshot } = {}) => {
  const handlers = new Map();
  const events = makeEvents();
  let component;
  let renders = 0;
  let activeEntries;
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const theme = { bold: text => text, fg: (_color, text) => text };
  const tui = {
    requestRender: () => {
      renders += 1;
    },
  };
  if (respond) {
    events.on("subagents:cost:v1:request", request => {
      const response = respond(request);
      if (response) {
        events.emit(`subagents:cost:v1:reply:${request.requestId}`, response);
      }
    });
  }
  if (snapshot) events.on(REQUEST_EVENT, request => events.emit(SNAPSHOT_EVENT, { ...snapshot, sessionId: request.sessionId }));
  const pi = {
    appendEntry: (customType, data) => {
      activeEntries.push({ type: "custom", customType, data });
    },
    events,
    exec: async () => { assert.fail("Footer must not execute discovery commands"); },
    on: (name, handler) => handlers.set(name, handler),
  };
  claudeFooter(pi);

  const startSession = (sessionId, { cwd = "/tmp/project", entries, mode = "tui", reasoning = false } = {}) => {
    activeEntries = entries ?? [{
      message: {
        role: "assistant",
        usage: { cost: { total: 1.25 }, input: 100, output: 25 },
      },
      type: "message",
    }];
    const sessionEntries = activeEntries;
    const ctx = {
      cwd,
      getContextUsage: () => ({ contextWindow: 200_000, percent: 10 }),
      mode,
      model: { contextWindow: 200_000, name: "Test Model", provider: "test", reasoning },
      modelRegistry: {},
      sessionManager: {
        getEntries: () => sessionEntries,
        getBranch: () => { throw new Error("Footer must read whole-file entries"); },
        getSessionId: () => sessionId,
      },
      thinkingLevel: "off",
      ui: {
        setFooter: factory => {
          component?.dispose();
          component = factory(tui, theme);
        },
      },
    };
    handlers.get("session_start")({}, ctx);
    return ctx;
  };

  const render = (width = 200) => component.render(width).join("\n");
  t.after(() => handlers.get("session_shutdown")?.());
  return {
    dispose: () => component.dispose(), events, handlers, render, renders: () => renders, startSession,
    clock: value => { now = value; },
    emit: (name, event, ctx) => handlers.get(name)?.(event, ctx),
    entries: () => activeEntries,
  };
};

const costReply = (request, cost, incomplete = false) => ({
  data: {
    childUsage: { cost },
    incomplete,
    kind: "pi-subagents.cost-snapshot",
    sessionId: request.sessionId,
    version: 1,
  },
  requestId: request.requestId,
  success: true,
  version: 1,
});

test("renders incomplete child costs without a trailing plus", t => {
  const footer = setUp(t, {
    respond: request => costReply(request, 0.42, true),
  });
  footer.startSession("session-1");

  const output = footer.render();
  assert.match(output, /1\.250\.42/);
  assert.doesNotMatch(output, /0\.42/);
  assert.doesNotMatch(output, /sub /);
});

test("renders a zero child cost without a separate sub label", t => {
  const footer = setUp(t, {
    respond: request => costReply(request, 0),
  });
  footer.startSession("session-1");

  assert.match(footer.render(), /1\.250\.00/);
  assert.doesNotMatch(footer.render(), /sub /);
});

test("hides a zero subtotal when async child usage is unresolved", t => {
  const footer = setUp(t, {
    respond: request => costReply(request, 0, true),
  });
  footer.startSession("session-1");

  assert.match(footer.render(), /1\.25/);
  assert.doesNotMatch(footer.render(), /0\.00/);
});

test("refreshes pending child cost when a subagent completes", t => {
  let childCost = 0;
  let incomplete = true;
  const footer = setUp(t, {
    respond: request => costReply(request, childCost, incomplete),
  });
  footer.startSession("session-1");
  assert.doesNotMatch(footer.render(), /0\.00/);

  childCost = 0.42;
  incomplete = false;
  footer.events.emit("subagent:async-complete", { runId: "child-1" });

  assert.match(footer.render(), /1\.250\.42/);
});

test("hides the child cost while loading or unavailable", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const footer = setUp(t);
  footer.startSession("session-1");
  assert.match(footer.render(), /1\.25/);
  assert.doesNotMatch(footer.render(), /|n\/a|…/);

  t.mock.timers.tick(500);

  assert.match(footer.render(), /1\.25/);
  assert.doesNotMatch(footer.render(), /|n\/a|…/);
});

test("ignores a stale reply after switching sessions", t => {
  const requests = [];
  const footer = setUp(t, {
    respond: request => {
      requests.push(request);
    },
  });
  footer.startSession("session-1");
  footer.startSession("session-2");

  footer.events.emit(
    `subagents:cost:v1:reply:${requests[0].requestId}`,
    costReply(requests[0], 9.99),
  );
  assert.doesNotMatch(footer.render(), /9\.99/);

  footer.events.emit(
    `subagents:cost:v1:reply:${requests[1].requestId}`,
    costReply(requests[1], 0.42),
  );
  assert.match(footer.render(), /1\.250\.42/);
});

const snapshot = {
  version: 1,
  directories: [
    { path: `${homedir()}/projects/alpha`, workspace: "jj-workspace", revision: "abcdefgh", bookmark: "feature-a" },
    { path: "/other/projects/alpha", workspace: "git-worktree", bookmark: "feature-b" },
  ],
  pullRequests: [
    { repo: "owner/alpha", number: 12, url: "https://github.com/owner/alpha/pull/12" },
    { repo: "owner/alpha", number: 13, url: "https://github.com/owner/alpha/pull/13" },
    { repo: "owner/beta", number: 4, url: "https://github.com/owner/beta/pull/4" },
  ],
};

test("renders compact workspace paths and grouped repository PR links", t => {
  const footer = setUp(t, { snapshot });
  footer.startSession("session-1");
  const output = footer.render(500);
  assert.match(output, /⬡ ~\/projects\/alpha/);
  assert.match(output, / \/other\/projects\/alpha/);
  assert.doesNotMatch(output, /jj-workspace|git-worktree|abcdefgh|feature-a|feature-b/);
  assert.ok(output.includes("\x1b]8;;https://github.com/owner/alpha\x1b\\alpha\x1b]8;;\x1b\\ \x1b]8;;https://github.com/owner/alpha/pull/12\x1b\\#12\x1b]8;;\x1b\\ \x1b]8;;https://github.com/owner/alpha/pull/13"));
  assert.ok(output.includes("\x1b]8;;https://github.com/owner/beta\x1b\\beta\x1b]8;;\x1b\\ \x1b]8;;https://github.com/owner/beta/pull/4\x1b\\#4"));
});

test("restores bookmarks when PRs are cleared from context", t => {
  const footer = setUp(t, { snapshot });
  footer.startSession("session-1");
  assert.doesNotMatch(footer.render(500), /feature-a|feature-b/);

  footer.events.emit(SNAPSHOT_EVENT, { ...snapshot, sessionId: "session-1", pullRequests: [] });

  const output = footer.render(500);
  assert.match(output, /⬡ ~\/projects\/alpha ·  feature-a/);
  assert.match(output, / \/other\/projects\/alpha ·  feature-b/);
  assert.doesNotMatch(output, /#12|#13|#4/);
});

test("uses owner identity when repository short names are ambiguous", t => {
  const footer = setUp(t, { snapshot: { ...snapshot, pullRequests: [
    snapshot.pullRequests[0],
    { repo: "other/alpha", number: 2, url: "https://github.com/other/alpha/pull/2" },
  ] } });
  footer.startSession("session-1");
  const output = footer.render(500);
  assert.ok(output.includes("\x1b]8;;https://github.com/owner/alpha\x1b\\owner/alpha\x1b]8;;\x1b\\"));
  assert.ok(output.includes("\x1b]8;;https://github.com/other/alpha\x1b\\other/alpha\x1b]8;;\x1b\\"));
  assert.match(output, /#12.*#2/);
});

test("falls back to fresh cwd without a provider and ignores wrong sessions", t => {
  const footer = setUp(t);
  footer.startSession("session-1", { cwd: "/first/project" });
  assert.match(footer.render(), / \/first\/project/);
  footer.events.emit(SNAPSHOT_EVENT, { ...snapshot, sessionId: "other" });
  assert.doesNotMatch(footer.render(500), /feature-a|#12/);
  footer.startSession("session-2", { cwd: "/second/project" });
  assert.match(footer.render(), /\/second\/project/);
  assert.doesNotMatch(footer.render(), /\/first\/project/);
});

test("accepts a provider loaded after the footer and requests on tree navigation", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.events.emit(SNAPSHOT_EVENT, { ...snapshot, sessionId: "session-1" });
  assert.match(footer.render(500), /#12/);
  footer.events.on(REQUEST_EVENT, request => footer.events.emit(SNAPSHOT_EVENT, {
    version: 1, sessionId: request.sessionId, directories: [{ path: "/tree/branch" }], pullRequests: [],
  }));
  footer.handlers.get("session_tree")({}, ctx);
  assert.match(footer.render(), /\/tree\/branch/);
  assert.doesNotMatch(footer.render(500), /feature-a|#12/);
});

test("rejects unsafe hyperlink URLs and strips label control characters", t => {
  const footer = setUp(t, { snapshot: { ...snapshot,
    directories: [{ path: "/safe\x1b/path", bookmark: "branch\x07name" }],
    pullRequests: [{ repo: "bad/repo", number: 1, url: "https://github.com/bad/repo/pull/1\x1b]8;;evil" }],
  } });
  footer.startSession("session-1");
  assert.match(footer.render(), /\/safe\/path.*branchname/);
  assert.doesNotMatch(footer.render(), /\x1b|\x07|evil|#1/);
});

test("keeps wide paths and OSC8 links within narrow terminal columns", t => {
  const footer = setUp(t, { snapshot: { ...snapshot, directories: [{ path: "/工作/项目/alpha" }] } });
  footer.startSession("session-1");
  for (const width of [0, 1, 10, 24, 40, 80, 120]) {
    for (const line of footer.render(width).split("\n")) {
      assert.ok(visibleWidth(line) <= width, `line exceeds ${width} columns: ${visibleWidth(line)}`);
    }
  }
});

test("cleans snapshot and cost subscriptions on dispose and shutdown", t => {
  const footer = setUp(t);
  footer.startSession("session-1");
  assert.equal(footer.events.listenerCount(SNAPSHOT_EVENT), 1);
  footer.dispose();
  assert.equal(footer.events.listenerCount(SNAPSHOT_EVENT), 0);
  assert.equal(footer.events.listenerCount("subagent:async-complete"), 0);
  footer.startSession("session-2");
  assert.equal(footer.events.listenerCount(SNAPSHOT_EVENT), 1);
  footer.handlers.get("session_shutdown")();
  assert.equal(footer.events.listenerCount(SNAPSHOT_EVENT), 0);
});

test("requests a matching snapshot after replacing a disposed session footer", t => {
  const footer = setUp(t, { snapshot });
  footer.startSession("session-1");
  footer.startSession("session-2");
  assert.match(footer.render(500), /#12/);
  assert.equal(footer.events.listenerCount(SNAPSHOT_EVENT), 1);
});


test("ignores a matching-session snapshot with a malformed directory", t => {
  const footer = setUp(t, { snapshot });
  footer.startSession("session-1");
  const previous = footer.render(500);

  footer.events.emit(SNAPSHOT_EVENT, {
    ...snapshot, sessionId: "session-1", directories: [{ path: null }],
  });

  assert.equal(footer.render(500), previous);
});

test("ignores a matching-session snapshot with a malformed PR", t => {
  const footer = setUp(t, { snapshot });
  footer.startSession("session-1");
  const previous = footer.render(500);

  footer.events.emit(SNAPSHOT_EVENT, {
    ...snapshot, sessionId: "session-1", pullRequests: [{ url: null }],
  });

  assert.equal(footer.render(500), previous);
});

test("does not restart cost subscriptions after footer disposal", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  let requests = 0;
  footer.events.on("subagents:cost:v1:request", () => { requests += 1; });
  footer.dispose();
  footer.handlers.get("tool_execution_end")({ toolName: "subagent" }, ctx);
  footer.handlers.get("agent_settled")({}, ctx);
  assert.equal(requests, 0);
});

test("links local repositories without PRs and retains bookmarks", t => {
  const footer = setUp(t, { snapshot: {
    version: 1,
    directories: [{ path: "/local/alpha", workspace: "jj-workspace", bookmark: "feature-a", githubUrls: ["https://github.com/Owner/Alpha.git/"] }],
    pullRequests: [],
  } });
  footer.startSession("session-1");

  const output = footer.render(500);
  assert.match(output, /⬡ \/local\/alpha ·  feature-a/);
  assert.ok(output.includes(" \x1b]8;;https://github.com/owner/alpha\x1b\\alpha\x1b]8;;\x1b\\"));
  assert.doesNotMatch(output, /#|Owner|\.git/);
});

test("deduplicates repository identities across directories and explicit PRs", t => {
  const footer = setUp(t, { snapshot: {
    version: 1,
    directories: [
      { path: "/first", bookmark: "first-branch", githubUrls: ["git@github.com:Owner/Alpha.git", "https://github.com/owner/alpha/"] },
      { path: "/second", bookmark: "second-branch", githubUrls: ["ssh://git@github.com/OWNER/ALPHA.git"] },
    ],
    pullRequests: [
      { url: "https://github.com/OWNER/Alpha/pull/12" },
      { url: "https://github.com/owner/alpha/pull/12" },
      { url: "https://github.com/owner/alpha/pull/13" },
    ],
  } });
  footer.startSession("session-1");

  const output = footer.render(500);
  assert.equal(output.match(//g)?.length, 1);
  assert.equal(output.match(/#12/g)?.length, 1);
  assert.equal(output.match(/#13/g)?.length, 1);
  assert.ok(output.includes("\x1b]8;;https://github.com/owner/alpha\x1b\\alpha\x1b]8;;\x1b\\"));
  assert.doesNotMatch(output, /first-branch|second-branch/);
});

test("disambiguates short names across local and PR repositories", t => {
  const footer = setUp(t, { snapshot: {
    version: 1,
    directories: [{ path: "/local", githubUrls: ["https://github.com/owner/alpha", "https://github.com/owner/beta"] }],
    pullRequests: [{ url: "https://github.com/other/alpha/pull/2" }],
  } });
  footer.startSession("session-1");

  const output = footer.render(500);
  assert.ok(output.includes("\x1b]8;;https://github.com/owner/alpha\x1b\\owner/alpha\x1b]8;;\x1b\\"));
  assert.ok(output.includes("\x1b]8;;https://github.com/other/alpha\x1b\\other/alpha\x1b]8;;\x1b\\"));
  assert.ok(output.includes("\x1b]8;;https://github.com/owner/beta\x1b\\beta\x1b]8;;\x1b\\"));
});

test("ignores malformed optional repository metadata without losing directory context", t => {
  const footer = setUp(t, { snapshot: {
    version: 1,
    directories: [
      { path: "/string", githubUrls: "https://github.com/owner/string" },
      { path: "/object", githubUrls: { url: "https://github.com/owner/object" } },
      { path: "/null", githubUrls: null },
      { path: "/array", bookmark: "local-branch", githubUrls: [null, 42, {}, "https://example.com/owner/repo", "https://github.com/owner/unsafe\x1b]8;;evil", "https://user:password@github.com/owner/private", "https://github.com/owner/safe"] },
    ],
    pullRequests: [{ url: "https://example.com/owner/repo/pull/1" }],
  } });
  footer.startSession("session-1");

  const output = footer.render(500);
  assert.match(output, /\/string.*\/object.*\/null.*\/array ·  local-branch/);
  assert.equal(output.match(//g)?.length, 1);
  assert.ok(output.includes("\x1b]8;;https://github.com/owner/safe\x1b\\safe\x1b]8;;\x1b\\"));
  assert.doesNotMatch(output, /example\.com|evil|password|private|unsafe|#1/);
});

test("clears repository labels when optional enrichment is removed", t => {
  const footer = setUp(t, { snapshot: {
    version: 1,
    directories: [{ path: "/local", githubUrls: ["https://github.com/owner/alpha"] }],
    pullRequests: [],
  } });
  footer.startSession("session-1");
  assert.match(footer.render(500), //);

  footer.events.emit(SNAPSHOT_EVENT, {
    version: 1, sessionId: "session-1", directories: [{ path: "/local", githubUrls: [] }], pullRequests: [],
  });

  assert.match(footer.render(500), /\/local/);
  assert.doesNotMatch(footer.render(500), /|alpha|\x1b/);
});

test("keeps repository-only hyperlinks within narrow terminal columns", t => {
  const footer = setUp(t, { snapshot: {
    version: 1,
    directories: [{ path: "/工作/项目", bookmark: "feature", githubUrls: ["https://github.com/owner/long-repository-name", "https://github.com/other/long-repository-name"] }],
    pullRequests: [],
  } });
  footer.startSession("session-1");
  for (const width of [0, 1, 10, 24, 40, 80, 120]) {
    for (const line of footer.render(width).split("\n")) {
      assert.ok(visibleWidth(line) <= width, `line exceeds ${width} columns: ${visibleWidth(line)}`);
    }
  }
});

const response = (output, stopReason = "stop") => ({
  message: { role: "assistant", usage: { output }, stopReason },
});
const sampleEntry = (sampleId, outputTokens, elapsedMs, version = 1) => ({
  type: "custom",
  customType: "claude-footer:throughput:v1",
  data: { version, sampleId, outputTokens, elapsedMs },
});

test("shows weighted model-call throughput immediately right of effort", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { reasoning: true });
  assert.doesNotMatch(footer.render(), /tps/);
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  // Stream start occurs late: latency and reasoning before it still count.
  footer.emit("message_start", response(0), ctx);
  footer.clock(2000);
  const rendersBefore = footer.renders();
  footer.emit("message_end", response(100), ctx);
  assert.match(footer.render(), /Test Model ·  off ·  50\.0 tps/);
  assert.equal(footer.renders(), rendersBefore + 1);

  footer.clock(12000);
  footer.emit("tool_execution_end", { toolName: "bash" }, ctx);
  footer.clock(22000);
  footer.emit("context_with_system", {}, ctx);
  footer.clock(30000);
  footer.emit("message_end", response(200, "toolUse"), ctx);
  assert.match(footer.render(), /off ·  30\.0 tps/);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 2);
});

test("restores whole-file paired samples on reload and resume without double counting", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(2000);
  footer.emit("message_end", response(100), ctx);
  const entries = footer.entries();
  // Untimed historical output is excluded even with huge usage.
  entries.push({ type: "message", message: {
    role: "assistant", usage: { input: 0, output: 900000, cost: { total: 0 } },
  } });
  entries.push(entries.find(entry => entry.type === "custom"));
  footer.startSession("session-1", { entries });
  assert.match(footer.render(), / 50\.0 tps/);
  footer.startSession("session-2");
  assert.doesNotMatch(footer.render(), /tps/);
  const resumed = footer.startSession("session-1", { entries });
  assert.match(footer.render(), / 50\.0 tps/);
  footer.emit("message_end", response(100), resumed);
  assert.match(footer.render(), / 50\.0 tps/);
  footer.emit("context_with_system", {}, resumed);
  footer.clock(10000);
  footer.emit("message_end", response(200), resumed);
  assert.match(footer.render(), / 30\.0 tps/);
});

test("ignores invalid persisted pairs and unrelated custom entries", t => {
  const footer = setUp(t);
  footer.startSession("session-1", { entries: [
    sampleEntry("zero", 10, 0),
    sampleEntry("negative", 10, -1),
    sampleEntry("infinite", 10, Infinity),
    sampleEntry("nan", NaN, 1000),
    sampleEntry("empty", 0, 1000),
    sampleEntry("version", 100, 1000, 2),
    sampleEntry("", 100, 1000),
    { type: "custom", customType: "claude-footer:throughput:v1", data: null },
    { type: "custom", customType: "subagent", data: { outputTokens: 9000, elapsedMs: 1 } },
  ] });
  assert.doesNotMatch(footer.render(), /tps/);
});

test("discards unmatched, failed, aborted, zero-output and invalid live timings", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("message_end", response(100), ctx);
  footer.emit("context_with_system", {}, ctx);
  footer.emit("message_end", response(100), ctx); // zero duration
  footer.clock(2000);
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_end", response(100), ctx); // backwards clock
  footer.emit("context_with_system", {}, ctx);
  footer.clock(Infinity);
  footer.emit("message_end", response(100), ctx);
  footer.clock(2000);
  footer.emit("context_with_system", {}, ctx);
  footer.clock(3000);
  footer.emit("message_end", response(100, "error"), ctx);
  footer.emit("context_with_system", {}, ctx);
  footer.clock(4000);
  footer.emit("message_end", response(100, "aborted"), ctx);
  footer.emit("context_with_system", {}, ctx);
  footer.clock(5000);
  footer.emit("message_end", response(0), ctx);
  footer.emit("context_with_system", {}, ctx);
  footer.clock(6000);
  footer.emit("message_end", response(NaN), ctx);
  assert.doesNotMatch(footer.render(), /tps/);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 0);
});

test("a fresh call replaces unmatched timing and non-assistant messages do not end it", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(10000);
  footer.emit("context_with_system", {}, ctx);
  footer.clock(11000);
  footer.emit("message_end", { message: { role: "user" } }, ctx);
  footer.clock(12000);
  footer.emit("message_end", response(100), ctx);
  footer.clock(14000);
  footer.emit("message_end", response(100), ctx);
  assert.match(footer.render(), / 50\.0 tps/);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 1);
});

test("clears pending calls on agent end and session changes", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.emit("agent_end", {}, ctx);
  footer.clock(1000);
  footer.emit("message_end", response(100), ctx);
  footer.emit("context_with_system", {}, ctx);
  footer.emit("session_before_switch", {}, ctx);
  footer.clock(2000);
  footer.emit("message_end", response(100), ctx);
  footer.emit("context_with_system", {}, ctx);
  const next = footer.startSession("session-2");
  footer.clock(3000);
  footer.emit("message_end", response(100), next);
  assert.doesNotMatch(footer.render(), /tps/);
});

test("does not install a footer or persist timings outside TUI mode", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { mode: "rpc" });
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_end", response(100), ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 0);
  assert.throws(() => footer.render(), TypeError);
});

test("a newly loaded extension restores persisted measurements without live timing", t => {
  const original = setUp(t);
  const ctx = original.startSession("session-1");
  original.emit("context_with_system", {}, ctx);
  original.clock(2000);
  original.emit("message_end", response(100), ctx);
  const reloaded = setUp(t);
  reloaded.startSession("session-1", {
    entries: JSON.parse(JSON.stringify(original.entries())),
  });
  assert.match(reloaded.render(), / 50\.0 tps/);
});

test("rejects foreign-session completions and clears pending calls on fork and shutdown", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  const foreign = { ...ctx, sessionManager: {
    ...ctx.sessionManager, getSessionId: () => "other-session",
  } };
  footer.emit("message_end", response(100), foreign);
  footer.emit("context_with_system", {}, ctx);
  footer.emit("session_before_fork", {}, ctx);
  footer.clock(2000);
  footer.emit("message_end", response(100), ctx);
  footer.emit("context_with_system", {}, ctx);
  footer.emit("session_shutdown", {}, ctx);
  footer.clock(3000);
  footer.emit("message_end", response(100), ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 0);
});

const update = (type, delta = "") => ({
  message: { role: "assistant" }, assistantMessageEvent: { type, delta },
});
const generationEntry = (id, tokens, ms) => ({
  ...sampleEntry(id, tokens, ms), customType: "claude-footer:generation-throughput:v1",
});

test("generation excludes late stream start and pre-output reasoning tokens and time", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { reasoning: true });
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_start", response(0), ctx);
  footer.emit("message_update", update("thinking_delta", "reasoning"), ctx);
  footer.clock(9000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(10000);
  const final = response(100);
  final.message.usage.reasoning = 60;
  footer.emit("message_end", final, ctx);
  assert.match(footer.render(), /off ·  40\.0 tps ·  10\.0 tps/);
  assert.equal(footer.entries().at(-1).data.elapsedMs, 1000);
  assert.equal(footer.entries().at(-1).data.outputTokens, 40);
});

test("only the first real output delta starts generation, not structure, empty or foreign updates", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_start"), ctx);
  footer.emit("message_update", update("toolcall_start"), ctx);
  footer.emit("message_update", update("text_delta"), ctx);
  footer.emit("message_update", update("toolcall_delta"), ctx);
  footer.emit("message_update", { ...update("text_delta", "foreign"), message: { role: "user" } }, ctx);
  const foreign = { ...ctx, sessionManager: { ...ctx.sessionManager, getSessionId: () => "other" } };
  footer.emit("message_update", update("text_delta", "foreign"), foreign);
  footer.clock(2000);
  footer.emit("message_update", update("text_delta", "first"), ctx);
  footer.clock(3000);
  footer.emit("message_update", update("text_delta", "later"), ctx);
  footer.clock(4000);
  footer.emit("message_end", response(100), ctx);
  assert.match(footer.render(), / 50\.0 tps ·  25\.0 tps/);
});

test("toolcall-only streamed output contributes generation tokens", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(2000);
  footer.emit("message_update", update("toolcall_delta", '{"command":'), ctx);
  footer.clock(4000);
  footer.emit("message_end", response(80, "toolUse"), ctx);
  assert.match(footer.render(), / 40\.0 tps ·  20\.0 tps/);
});

test("missing reasoning breakdown on an active reasoning model preserves request-only sample", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { reasoning: true });
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  footer.emit("message_end", response(100), ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 1);
  assert.match(footer.render(), /off ·  50\.0 tps/);
});

test("finalized off effort permits generation without a reasoning breakdown", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { reasoning: true });
  ctx.thinkingLevel = "high";
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  const final = response(100);
  final.message.thinkingLevel = "off";
  footer.emit("message_end", final, ctx);
  assert.match(footer.render(), / 100\.0 tps ·  50\.0 tps/);
});

test("observed thinking overrides finalized off when breakdown is missing", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { reasoning: true });
  footer.emit("context_with_system", {}, ctx);
  footer.emit("message_update", update("thinking_start"), ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  const final = response(100);
  final.message.thinkingLevel = "off";
  footer.emit("message_end", final, ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 1);
});

for (const [name, reasoning] of [["negative", -1], ["nonfinite", Infinity], ["NaN", NaN], ["greater than output", 101]]) {
  test(`invalid ${name} reasoning breakdown cannot become generation tokens`, t => {
    const footer = setUp(t);
    const ctx = footer.startSession("session-1");
    footer.emit("context_with_system", {}, ctx);
    footer.clock(1000);
    footer.emit("message_update", update("text_delta", "answer"), ctx);
    footer.clock(2000);
    const final = response(100);
    final.message.usage.reasoning = reasoning;
    footer.emit("message_end", final, ctx);
    assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 1);
    assert.match(footer.render(), / 50\.0 tps/);
  });
}

test("zero visible tokens after subtracting reasoning retains only request sample", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  const final = response(100);
  final.message.usage.reasoning = 100;
  footer.emit("message_end", final, ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 1);
});

test("zero generation duration retains only request sample", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(2000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.emit("message_end", response(100), ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 1);
});

test("persisted generation and v1 request samples aggregate independently and deduplicate on reload", t => {
  const footer = setUp(t);
  const generation = generationEntry("same-id", 100, 2000);
  const entries = [generation, generation, generationEntry("second", 200, 8000),
    sampleEntry("same-id", 400, 20000), sampleEntry("request-only", 200, 10000)];
  footer.startSession("session-1", { entries });
  assert.match(footer.render(), / 30\.0 tps ·  20\.0 tps/);
  const reload = setUp(t);
  reload.startSession("session-1", { entries: JSON.parse(JSON.stringify(entries)) });
  assert.match(reload.render(), / 30\.0 tps ·  20\.0 tps/);
  reload.startSession("session-2");
  assert.doesNotMatch(reload.render(), /tps/);
  reload.startSession("session-1", { entries });
  assert.match(reload.render(), / 30\.0 tps ·  20\.0 tps/);
  assert.ok(reload.render(20).split("\n").every(line => hostRequire("@earendil-works/pi-tui").visibleWidth(line) <= 20));
});

test("failed streamed response persists neither metric", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  footer.emit("message_end", response(100, "error"), ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 0);
});

test("a valid zero reasoning breakdown permits generation even on a reasoning model", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { reasoning: true });
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  const final = response(100);
  final.message.usage.reasoning = 0;
  footer.emit("message_end", final, ctx);
  assert.match(footer.render(), / 100\.0 tps ·  50\.0 tps/);
});

test("finalized thinking content prevents fallback to total output when breakdown is absent", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { reasoning: true });
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  const final = response(100);
  final.message.thinkingLevel = "off";
  final.message.content = [{ type: "thinking", thinking: "hidden" }];
  footer.emit("message_end", final, ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 1);
});

test("aborted streamed response persists neither metric", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  footer.emit("message_end", response(100, "aborted"), ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 0);
});

test("non-TUI streamed responses persist neither metric", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1", { mode: "rpc" });
  footer.emit("context_with_system", {}, ctx);
  footer.clock(1000);
  footer.emit("message_update", update("text_delta", "answer"), ctx);
  footer.clock(2000);
  footer.emit("message_end", response(100), ctx);
  assert.equal(footer.entries().filter(entry => entry.type === "custom").length, 0);
});
