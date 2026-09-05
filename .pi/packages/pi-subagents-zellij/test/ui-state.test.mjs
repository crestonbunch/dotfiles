import assert from "node:assert/strict";
import test from "node:test";
import { DashboardState } from "../lib/ui-state.mjs";

const snapshot = {
  kind: "pi-subagents.async-status-snapshot",
  version: 1,
  runs: [
    { id: "new-run", label: "worker", state: "running", children: [{ id: "step:0", kind: "step", label: "worker", state: "running" }] },
  ],
};

test("late transcript reply cannot overwrite changed selection", () => {
  const state = new DashboardState();
  state.applySnapshot(snapshot);
  const staleGeneration = state.beginSelectionChange("run:new-run");
  const currentGeneration = state.beginSelectionChange("child:new-run:step:0");
  assert.equal(state.applyTranscript(staleGeneration, "stale text"), false);
  assert.equal(state.applyTranscript(currentGeneration, "current text"), true);
  assert.equal(state.transcript, "current text");
});

test("snapshot refresh preserves canonical selected identity", () => {
  const state = new DashboardState();
  state.applySnapshot(snapshot);
  state.selectedId = "child:new-run:step:0";
  state.applySnapshot(structuredClone(snapshot));
  assert.equal(state.selectedId, "child:new-run:step:0");
});
