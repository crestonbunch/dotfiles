import assert from "node:assert/strict";
import test from "node:test";
import { buildFocusArgv, buildOpenArgv, findCapturedTab, findVerifiedPane, parseCreatedPaneId } from "../lib/zellij.mjs";

test("open argv pins the captured tab without conflicting near-current-pane", () => {
  assert.deepEqual(buildOpenArgv({
    sessionName: "work session",
    tabId: 7,
    cwd: "/tmp/a path; echo no",
    title: "subagents · abc",
    nodePath: "/opt/node",
    viewerPath: "/tmp/viewer.mjs",
    socketPath: "/tmp/rpc.sock",
    token: "token",
  }), [
    "--session", "work session", "action", "new-pane", "--tab-id", "7", "--close-on-exit",
    "--cwd", "/tmp/a path; echo no", "--name", "subagents · abc", "--",
    "/opt/node", "/tmp/viewer.mjs", "--socket", "/tmp/rpc.sock", "--token", "token",
  ]);
});

test("focus argv uses only a validated saved pane identity", () => {
  assert.deepEqual(buildFocusArgv("work", "terminal_12"), ["--session", "work", "action", "focus-pane-id", "terminal_12"]);
  assert.throws(() => buildFocusArgv("work", "12; close-pane"));
});

test("pane verification requires exact terminal id, tab, title and live state", () => {
  const panes = [{ id: 12, is_plugin: false, tab_id: 7, title: "subagents · abc", exited: false }];
  assert.equal(findVerifiedPane(panes, { paneId: "terminal_12", tabId: 7, title: "subagents · abc" }), panes[0]);
  assert.equal(findVerifiedPane(panes, { paneId: "terminal_12", tabId: 8, title: "subagents · abc" }), undefined);
});

test("captured pane must resolve to one unambiguous tab", () => {
  assert.equal(findCapturedTab([{ id: 3, is_plugin: false, tab_id: 9, exited: false }], "3"), 9);
  assert.equal(findCapturedTab([{ id: 3, is_plugin: false, tab_id: 9, exited: false }, { id: 3, is_plugin: false, tab_id: 10, exited: false }], "3"), undefined);
});

test("created pane parser accepts only terminal identifiers", () => {
  assert.equal(parseCreatedPaneId("terminal_42\n"), "terminal_42");
  assert.throws(() => parseCreatedPaneId("plugin_42"));
});
