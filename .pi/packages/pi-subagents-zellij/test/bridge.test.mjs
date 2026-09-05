import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDashboardHandler, createEventRpc, startSocketBridge } from "../lib/bridge.mjs";

class Events {
  handlers = new Map();
  on(name, handler) {
    this.handlers.set(name, handler);
    return () => this.handlers.delete(name);
  }
  emit(name, value) {
    this.handlers.get(name)?.(value);
  }
}

const snapshot = {
  kind: "pi-subagents.async-status-snapshot",
  version: 1,
  omitted: { children: 0 },
  runs: [{ id: "run-a", label: "two", state: "running", children: [
    { id: "step:0", kind: "step", label: "first", state: "running" },
    { id: "step:1", kind: "step", label: "second", state: "running" },
  ] }],
};

test("event RPC times out and removes its reply listener", async () => {
  const events = new Events();
  const rpc = createEventRpc(events, { timeoutMs: 10 });
  await assert.rejects(rpc.call("ping"), { code: "timeout" });
  assert.equal(events.handlers.size, 0);
  rpc.close();
});

test("closing event RPC rejects pending requests and cleans listeners", async () => {
  const events = new Events();
  const rpc = createEventRpc(events, { timeoutMs: 1000 });
  const pending = rpc.call("status");
  rpc.close();
  await assert.rejects(pending, { code: "disconnected" });
  assert.equal(events.handlers.size, 0);
});

test("child steer revalidates snapshot and rich status before using exact index", async () => {
  const calls = [];
  const rpc = {
    async call(method, params) {
      calls.push({ method, params });
      if (method === "status" && Object.keys(params).length === 0) return { asyncSnapshot: snapshot };
      if (method === "steer") return { details: { steering: { requestId: "receipt-1", state: "delivered", deliveryStatus: "delivered", sourceRunId: "run-a", targets: [{ index: 1, state: "delivered" }] } } };
      return { text: "rich status" };
    },
  };
  const handler = createDashboardHandler({ rpc, token: "token" });
  const result = await handler({ version: 1, id: "request", token: "token", method: "steer", params: { runId: "run-a", childId: "step:1", message: "check this", mode: "steer" } });
  assert.equal(result.receipt.deliveryStatus, "delivered");
  assert.deepEqual(calls, [
    { method: "status", params: {} },
    { method: "status", params: { id: "run-a" } },
    { method: "steer", params: { id: "run-a", message: "check this", mode: "steer", index: 1 } },
  ]);
});

test("selected child never downgrades to run-level broadcast", async () => {
  const rpc = { async call() { return { asyncSnapshot: snapshot }; } };
  const handler = createDashboardHandler({ rpc, token: "token" });
  await assert.rejects(
    handler({ version: 1, id: "request", token: "token", method: "steer", params: { runId: "run-a", childId: "workflow-key", message: "check", broadcastConfirmed: true } }),
    { code: "unmappable_child" },
  );
});

test("multi-child run steer fails until broadcast is explicitly confirmed", async () => {
  const calls = [];
  const rpc = {
    async call(method, params) {
      calls.push({ method, params });
      if (method === "status" && Object.keys(params).length === 0) return { asyncSnapshot: snapshot };
      if (method === "steer") return { details: { steering: { requestId: "receipt-2", state: "queued", deliveryStatus: "queued", sourceRunId: "run-a", targets: [] } } };
      return { text: "rich status" };
    },
  };
  const handler = createDashboardHandler({ rpc, token: "token" });
  await assert.rejects(handler({ version: 1, id: "request", token: "token", method: "steer", params: { runId: "run-a", message: "check" } }), { code: "confirmation_required" });
  assert.equal(calls.some((call) => call.method === "steer"), false);
});

test("socket bridge applies private permissions and removes socket on close", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-saz-test-"));
  const socketPath = join(root, "private", "rpc.sock");
  const bridge = await startSocketBridge({ socketPath, handler: async () => ({ ok: true }) });
  assert.equal(statSync(join(root, "private")).mode & 0o777, 0o700);
  assert.equal(statSync(socketPath).mode & 0o777, 0o600);
  await bridge.close();
  assert.equal(existsSync(socketPath), false);
});
