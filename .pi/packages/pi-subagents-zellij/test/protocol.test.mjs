import assert from "node:assert/strict";
import test from "node:test";
import { projectPickerItems, resolveSelection, sanitizeTerminal, validateRequest } from "../lib/protocol.mjs";

const snapshot = {
  kind: "pi-subagents.async-status-snapshot",
  version: 1,
  omitted: { children: 0 },
  runs: [{
    id: "run-123",
    label: "parallel",
    state: "running",
    children: [
      { id: "step:0", kind: "step", label: "worker", state: "running" },
      { id: "workflow-key", kind: "step", label: "reviewer", state: "running" },
    ],
  }],
};

test("exact public step identity resolves to its canonical numeric index", () => {
  assert.deepEqual(resolveSelection(snapshot, "run-123", "step:0").index, 0);
});

test("opaque workflow child stays visible but cannot be individually targeted", () => {
  assert.throws(() => resolveSelection(snapshot, "run-123", "workflow-key"), { code: "unmappable_child" });
  assert.equal(projectPickerItems(snapshot)[2].targetable, false);
});

test("duplicate child identity is rejected as ambiguous", () => {
  const duplicate = structuredClone(snapshot);
  duplicate.runs[0].children.push({ id: "step:0", kind: "step", label: "other", state: "running" });
  assert.throws(() => resolveSelection(duplicate, "run-123", "step:0"), { code: "ambiguous" });
});

test("host node that resembles a numeric step remains view-only", () => {
  const host = structuredClone(snapshot);
  host.runs[0].children = [{ id: "step:0", kind: "host-step", label: "CI", state: "running" }];
  assert.throws(() => resolveSelection(host, "run-123", "step:0"), { code: "unmappable_child" });
  assert.equal(projectPickerItems(host)[1].targetable, false);
});

test("run selection requires broadcast confirmation when multiple children exist", () => {
  assert.equal(resolveSelection(snapshot, "run-123").requiresBroadcastConfirmation, true);
});

test("request allowlist rejects filesystem and control parameters", () => {
  assert.throws(() => validateRequest({ version: 1, id: "1", token: "secret", method: "transcript", params: { runId: "run-123", cwd: "/tmp" } }, "secret"), { code: "invalid_request" });
  assert.throws(() => validateRequest({ version: 1, id: "1", token: "wrong", method: "snapshot", params: {} }, "secret"), { code: "unauthorized" });
});

test("terminal sanitizer removes CSI, OSC, C0 and C1 controls", () => {
  assert.equal(sanitizeTerminal("safe\u001b[31mred\u001b[0m\u001b]0;owned\u0007!\u0001\u009b31m"), "safered!");
});
