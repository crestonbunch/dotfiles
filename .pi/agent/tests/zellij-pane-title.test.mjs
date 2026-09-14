import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import zellijTabStatus from "../extensions/zellij-pane-title.ts";

const setUp = (t, { mode = "tui", zellij = "1", runs, fleet } = {}) => {
  const previousZellij = process.env.ZELLIJ;
  if (zellij) process.env.ZELLIJ = zellij;
  else delete process.env.ZELLIJ;
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const handlers = new Map();
  const events = new EventEmitter();
  const status = { runs, fleet };
  events.on("subagents:rpc:v1:request", ({ requestId }) => {
    if (status.runs === undefined) return;
    events.emit(`subagents:rpc:v1:reply:${requestId}`, {
      version: 1, requestId, success: true,
      data: { fleet: status.fleet, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: status.runs } },
    });
  });
  let title;
  let idle = true;
  const ctx = {
    mode,
    isIdle: () => idle,
    sessionManager: { getSessionId: () => "session" },
    ui: { setTitle: (value) => { title = value; } },
  };
  zellijTabStatus({
    on: (name, handler) => handlers.set(name, handler),
    events: {
      emit: (name, data) => events.emit(name, data),
      on: (name, handler) => {
        events.on(name, handler);
        return () => events.off(name, handler);
      },
    },
  });
  const fire = (name, data = {}) => handlers.get(name)(data, ctx);
  t.after(() => {
    fire("session_shutdown");
    if (previousZellij === undefined) delete process.env.ZELLIJ;
    else process.env.ZELLIJ = previousZellij;
  });
  fire("session_start");
  t.mock.timers.tick(1);
  return {
    events,
    status,
    fire,
    title: () => title,
    start: () => { idle = false; fire("agent_start"); },
    settle: () => { idle = true; fire("agent_settled"); },
  };
};

test("keeps animating after the parent settles until every async run completes", (t) => {
  const pane = setUp(t);
  pane.start();
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "session" });
  pane.events.emit("subagent:async-started", { id: "b", sessionId: "session" });
  pane.settle();
  assert.equal(pane.title(), "⠋ pi");
  t.mock.timers.tick(80);
  assert.equal(pane.title(), "⠙ pi");
  pane.events.emit("subagent:async-complete", { runId: "a" });
  assert.equal(pane.title(), "⠙ pi");
  pane.events.emit("subagent:async-complete", { runId: "b" });
  assert.equal(pane.title(), "󰄬 pi");
});

test("deduplicates starts and ignores unrelated completions", (t) => {
  const pane = setUp(t);
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "session" });
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "session" });
  pane.events.emit("subagent:async-complete", { runId: "unknown" });
  assert.equal(pane.title(), "⠋ pi");
  pane.events.emit("subagent:async-complete", { id: "a" });
  assert.equal(pane.title(), "󰄬 pi");
});

test("does not stop a busy parent when its subagent finishes", (t) => {
  const pane = setUp(t);
  pane.start();
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "session" });
  pane.events.emit("subagent:async-complete", { runId: "a" });
  assert.equal(pane.title(), "⠋ pi");
  pane.settle();
  assert.equal(pane.title(), "󰄬 pi");
});

test("shows background activity during a UI prompt, then restores waiting status", (t) => {
  const pane = setUp(t);
  pane.start();
  pane.fire("ui_prompt_start");
  assert.equal(pane.title(), "󰄬 pi");
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "session" });
  assert.equal(pane.title(), "⠋ pi");
  pane.events.emit("subagent:async-complete", { runId: "a" });
  assert.equal(pane.title(), "󰄬 pi");
  pane.fire("ui_prompt_end");
  assert.equal(pane.title(), "⠋ pi");
});

test("preserves parent failure status after background work ends", (t) => {
  const pane = setUp(t);
  pane.start();
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "session" });
  pane.fire("message_end", { message: { role: "assistant", stopReason: "error" } });
  pane.settle();
  assert.equal(pane.title(), "⠋ pi");
  pane.events.emit("subagent:async-complete", { runId: "a" });
  assert.equal(pane.title(), "󰅖 pi");
});

test("ignores foreign sessions and malformed events", (t) => {
  const pane = setUp(t);
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "foreign" });
  pane.events.emit("subagent:async-started", null);
  pane.events.emit("subagent:async-started", { sessionId: "session" });
  pane.events.emit("subagent:async-complete", null);
  assert.equal(pane.title(), "󰄬 pi");
});

test("shutdown clears listeners and prevents later title updates", (t) => {
  const pane = setUp(t);
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "session" });
  pane.fire("session_shutdown");
  pane.events.emit("subagent:async-started", { id: "b", sessionId: "session" });
  t.mock.timers.tick(800);
  assert.equal(pane.title(), "pi");
  assert.equal(pane.events.listenerCount("subagent:async-started"), 0);
  assert.equal(pane.events.listenerCount("subagent:async-complete"), 0);
});

test("recovers running workflows from the status snapshot after reload", (t) => {
  const pane = setUp(t, { runs: [{ id: "workflow", state: "running" }] });
  assert.equal(pane.title(), "⠋ pi");
  pane.status.runs = [{ id: "workflow", state: "completed" }];
  t.mock.timers.tick(2000);
  assert.equal(pane.title(), "󰄬 pi");
});

test("keeps queued runs busy and ignores historical terminal runs", (t) => {
  const pane = setUp(t, { runs: [{ id: "queued", state: "queued" }, { id: "old", state: "failed" }] });
  assert.equal(pane.title(), "⠋ pi");
  pane.status.runs = [{ id: "old", state: "failed" }];
  t.mock.timers.tick(2000);
  assert.equal(pane.title(), "󰄬 pi");
});

test("shows detached foreground activity from the fleet snapshot", (t) => {
  const pane = setUp(t, { runs: [], fleet: { version: 1, totalActive: 1 } });
  assert.equal(pane.title(), "⠋ pi");
  pane.status.fleet = { version: 1, totalActive: 0 };
  t.mock.timers.tick(2000);
  assert.equal(pane.title(), "󰄬 pi");
});

test("does not overwrite a new run with an older status reply", (t) => {
  const pane = setUp(t);
  let requestId;
  pane.events.on("subagents:rpc:v1:request", (request) => { requestId = request.requestId; });
  t.mock.timers.tick(2000);
  pane.events.emit("subagent:async-started", { id: "new", sessionId: "session" });
  pane.events.emit(`subagents:rpc:v1:reply:${requestId}`, {
    version: 1, requestId, success: true,
    data: { asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [] } },
  });
  assert.equal(pane.title(), "⠋ pi");
});

test("does not update pane titles in RPC mode", (t) => {
  const pane = setUp(t, { mode: "rpc" });
  pane.start();
  pane.events.emit("subagent:async-started", { id: "a", sessionId: "session" });
  assert.equal(pane.title(), undefined);
});

test("does not update pane titles outside Zellij", (t) => {
  const pane = setUp(t, { zellij: "" });
  pane.start();
  assert.equal(pane.title(), undefined);
});
