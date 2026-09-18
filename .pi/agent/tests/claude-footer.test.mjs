import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
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
const bootstrapJiti = createJiti(import.meta.url);
const { resolveHostPeerAliases } = await bootstrapJiti.import(
  "../npm/node_modules/pi-subagents/src/runs/background/runner-aliases.ts",
);
const { aliases, missing } = resolveHostPeerAliases(piPackageRoot);
assert.deepEqual(missing, []);
const jiti = createJiti(import.meta.url, { alias: aliases });
const claudeFooter = await jiti.import("../extensions/claude-footer.ts", {
  default: true,
});

const makeEvents = () => {
  const emitter = new EventEmitter();
  return {
    emit: (name, value) => emitter.emit(name, value),
    on: (name, handler) => {
      emitter.on(name, handler);
      return () => emitter.off(name, handler);
    },
  };
};

const setUp = (t, { respond } = {}) => {
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
  const pi = {
    events,
    exec: async () => ({ code: 1, stderr: "", stdout: "" }),
    on: (name, handler) => handlers.set(name, handler),
  };
  claudeFooter(pi);

  const startSession = sessionId => {
    const ctx = {
      cwd: "/tmp/project",
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
          component = factory(tui, theme);
        },
      },
    };
    handlers.get("session_start")({}, ctx);
    return ctx;
  };

  const render = () => component.render(200).join("\n");
  t.after(() => handlers.get("session_shutdown")?.());
  return { events, handlers, render, renders: () => renders, startSession };
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
