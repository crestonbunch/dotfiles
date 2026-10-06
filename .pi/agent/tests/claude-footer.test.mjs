import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
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
    events,
    exec: async () => { assert.fail("Footer must not execute discovery commands"); },
    on: (name, handler) => handlers.set(name, handler),
  };
  claudeFooter(pi);

  const startSession = (sessionId, cwd = "/tmp/project") => {
    const ctx = {
      cwd,
      getContextUsage: () => ({ contextWindow: 200_000, percent: 10 }),
      mode: "tui",
      model: { contextWindow: 200_000, name: "Test Model", provider: "test" },
      modelRegistry: {},
      sessionManager: {
        getEntries: () => [
          {
            message: {
              role: "assistant",
              usage: { cost: { total: 1.25 }, input: 100, output: 25 },
            },
            type: "message",
          },
        ],
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
  return { dispose: () => component.dispose(), events, handlers, render, renders: () => renders, startSession };
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

test("renders multiple annotated paths and grouped repository PR links", t => {
  const footer = setUp(t, { snapshot });
  footer.startSession("session-1");
  const output = footer.render(500);
  assert.match(output, /~\/projects\/alpha \[jj-workspace\].*abcdefgh.*feature-a/);
  assert.match(output, /\/other\/projects\/alpha \[git-worktree\].*feature-b/);
  assert.match(output, /alpha \x1b\]8;;https:\/\/github.com\/owner\/alpha\/pull\/12\x1b\\#12\x1b\]8;;\x1b\\ \x1b\]8;;https:\/\/github.com\/owner\/alpha\/pull\/13/);
  assert.match(output, /beta .*#4/);
});

test("uses owner identity when repository short names are ambiguous", t => {
  const footer = setUp(t, { snapshot: { ...snapshot, pullRequests: [
    snapshot.pullRequests[0],
    { repo: "other/alpha", number: 2, url: "https://github.com/other/alpha/pull/2" },
  ] } });
  footer.startSession("session-1");
  assert.match(footer.render(500), /owner\/alpha .*#12.*other\/alpha .*#2/);
});

test("falls back to fresh cwd without a provider and ignores wrong sessions", t => {
  const footer = setUp(t);
  footer.startSession("session-1", "/first/project");
  assert.match(footer.render(), /\/first\/project/);
  footer.events.emit(SNAPSHOT_EVENT, { ...snapshot, sessionId: "other" });
  assert.doesNotMatch(footer.render(500), /feature-a|#12/);
  footer.startSession("session-2", "/second/project");
  assert.match(footer.render(), /\/second\/project/);
  assert.doesNotMatch(footer.render(), /\/first\/project/);
});

test("accepts a provider loaded after the footer and requests on tree navigation", t => {
  const footer = setUp(t);
  const ctx = footer.startSession("session-1");
  footer.events.emit(SNAPSHOT_EVENT, { ...snapshot, sessionId: "session-1" });
  assert.match(footer.render(500), /feature-a/);
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
  assert.match(footer.render(500), /feature-a/);
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
