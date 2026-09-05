import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDashboardHandler, createEventRpc, startSocketBridge } from "../lib/bridge.mjs";
import { requestDashboard } from "../lib/client.mjs";
import { CLIENT_TIMEOUT_MS, OPERATION_TIMEOUT_MS, RPC_TIMEOUT_MS } from "../lib/protocol.mjs";
import { GuidanceDraft } from "../lib/ui-state.mjs";

const item = { id: "run:a", runId: "a", kind: "run", targetable: true };
const snapshot = { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "a", state: "running", children: [] }] };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("duplicate Enter or confirmation cannot start concurrent guidance", () => {
  const draft = new GuidanceDraft(item);
  assert.deepEqual(draft.begin(item, "first message", "steer"), { runId: "a", message: "first message", mode: "steer" });
  assert.equal(draft.begin(item, "duplicate", "auto"), undefined);
  draft.finish();
  assert.deepEqual(draft.begin(item, "changed after confirmation prompt", "auto"), { runId: "a", message: "first message", mode: "steer" });
  assert.equal(draft.begin(item, "duplicate confirmation", "auto"), undefined);
});

test("confirmation fails when polling replaces the selected target", () => {
  const draft = new GuidanceDraft(item);
  draft.begin(item, "guidance", "steer");
  draft.finish();
  assert.throws(() => draft.begin({ id: "run:b", runId: "b", targetable: true }, "guidance", "steer"), /selected target changed/);
  assert.equal(draft.sending, false);
});

test("a completed target cannot receive a saved draft", () => {
  const draft = new GuidanceDraft(item);
  assert.throws(() => draft.begin({ ...item, targetable: false }, "guidance", "steer"), /became unavailable/);
});

test("operation and client deadlines cover the bounded three-RPC chain", () => {
  assert.ok(OPERATION_TIMEOUT_MS > RPC_TIMEOUT_MS * 3);
  assert.ok(CLIENT_TIMEOUT_MS > OPERATION_TIMEOUT_MS);
});

test("event RPC cancellation removes listener and prevents subsequent dispatch", async () => {
  const handlers = new Map();
  const dispatched = [];
  const rpc = createEventRpc({
    on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name); },
    emit(name, payload) { dispatched.push(payload.method); },
  });
  const controller = new AbortController();
  const pending = rpc.call("status", {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: "disconnected" });
  await assert.rejects(rpc.call("steer", {}, { signal: controller.signal }), { code: "disconnected" });
  assert.deepEqual(dispatched, ["status"]);
  assert.equal(handlers.size, 0);
  rpc.close();
});

test("socket deadline cancels delayed status and never dispatches late steering", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "saz-reg-"));
  const socketPath = join(root, "rpc.sock");
  const entered = deferred();
  const release = deferred();
  const finished = deferred();
  const methods = [];
  const handler = createDashboardHandler({ token: "token", rpc: {
    async call(method) {
      methods.push(method);
      entered.resolve();
      await release.promise;
      return { asyncSnapshot: snapshot };
    },
  } });
  const bridge = await startSocketBridge({ socketPath, timeoutMs: 50, handler: async (raw, options) => {
    try { return await handler(raw, options); }
    finally { finished.resolve(); }
  } });
  t.after(async () => { release.resolve(); await bridge.close(); rmSync(root, { recursive: true, force: true }); });
  const pending = requestDashboard({ socketPath, token: "token", method: "steer", params: { runId: "a", message: "do not send late" }, timeoutMs: 1000 });
  const rejection = assert.rejects(pending, { code: "delivery_unknown" });
  await entered.promise;
  await rejection;
  release.resolve();
  await finished.promise;
  assert.deepEqual(methods, ["status"]);
});

test("client disconnect cancels ownership checks before steering", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "saz-disconnect-"));
  const socketPath = join(root, "rpc.sock");
  const entered = deferred();
  const aborted = deferred();
  const release = deferred();
  const finished = deferred();
  const methods = [];
  const handler = createDashboardHandler({ token: "token", rpc: {
    async call(method) {
      methods.push(method);
      entered.resolve();
      await release.promise;
      return { asyncSnapshot: snapshot };
    },
  } });
  const bridge = await startSocketBridge({ socketPath, handler: async (raw, options) => {
    options.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    try { return await handler(raw, options); }
    finally { finished.resolve(); }
  } });
  t.after(async () => { release.resolve(); await bridge.close(); rmSync(root, { recursive: true, force: true }); });
  const controller = new AbortController();
  const pending = requestDashboard({ socketPath, token: "token", method: "steer", params: { runId: "a", message: "cancel me" }, signal: controller.signal });
  const rejection = assert.rejects(pending, { code: "delivery_unknown" });
  await entered.promise;
  controller.abort();
  await rejection;
  await aborted.promise;
  release.resolve();
  await finished.promise;
  assert.deepEqual(methods, ["status"]);
});

test("lost RPC steering receipt is reported as unknown, not failed delivery", async () => {
  const handler = createDashboardHandler({ token: "token", rpc: {
    async call(method) {
      if (method === "steer") throw Object.assign(new Error("timeout"), { code: "timeout" });
      return { asyncSnapshot: snapshot };
    },
  } });
  await assert.rejects(handler({ version: 1, id: "x", token: "token", method: "steer", params: { runId: "a", message: "check" } }), { code: "delivery_unknown" });
});

test("reply decoding preserves UTF-8 characters split across socket chunks", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "saz-utf8-"));
  const socketPath = join(root, "rpc.sock");
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8"));
      const reply = Buffer.from(JSON.stringify({ version: 1, id: request.id, ok: true, data: { text: "héllo 🌍" } }));
      const split = reply.indexOf(Buffer.from("🌍")) + 1;
      socket.write(reply.subarray(0, split));
      setTimeout(() => socket.end(reply.subarray(split)), 20);
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  const response = await requestDashboard({ socketPath, token: "token", method: "snapshot" });
  assert.equal(response.text, "héllo 🌍");
});
