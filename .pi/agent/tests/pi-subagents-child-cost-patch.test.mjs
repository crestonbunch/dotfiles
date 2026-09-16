import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
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
const { registerSlashCommands } = await jiti.import(
  "../npm/node_modules/pi-subagents/src/slash/slash-commands.ts",
);

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

const childUsage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0.42,
  input: 10,
  output: 5,
  turns: 1,
};

const setUpCostApi = () => {
  const events = makeEvents();
  const commands = new Map();
  const messages = [];
  const childResult = { agent: "worker", runId: "child-1", usage: childUsage };
  const ctx = {
    cwd: "/tmp",
    sessionManager: {
      getBranch: () => [
        {
          message: {
            role: "assistant",
            usage: {
              cacheRead: 0,
              cacheWrite: 0,
              cost: { total: 1.25 },
              input: 100,
              output: 10,
            },
          },
          type: "message",
        },
        {
          message: {
            details: {
              completions: [
                { mode: "single", results: [childResult], runId: "parent-run" },
              ],
              mode: "single",
              results: [childResult, childResult],
            },
            role: "toolResult",
            toolName: "subagent",
          },
          type: "message",
        },
      ],
      getSessionFile: () => null,
      getSessionId: () => "session-1",
    },
  };
  const state = {
    artifactDirPreference: "session",
    baseCwd: "/tmp",
    lastUiContext: ctx,
  };
  const pi = {
    events,
    registerCommand: (name, command) => commands.set(name, command),
    registerShortcut: () => {},
    sendMessage: message => messages.push(message),
  };
  const registration = registerSlashCommands(pi, state);
  return { commands, ctx, events, messages, registration };
};

test("cost API uses the slash-command subtotal without double counting children", () => {
  const fixture = setUpCostApi();
  let reply;
  fixture.events.on("subagents:cost:v1:reply:request-1", value => {
    reply = value;
  });

  fixture.events.emit("subagents:cost:v1:request", {
    requestId: "request-1",
    sessionId: "session-1",
    version: 1,
  });

  assert.deepEqual(reply, {
    data: {
      childUsage,
      incomplete: false,
      kind: "pi-subagents.cost-snapshot",
      sessionId: "session-1",
      unresolvedAsyncChildren: 0,
      version: 1,
    },
    requestId: "request-1",
    success: true,
    version: 1,
  });
  fixture.registration.dispose();
});

test("slash output remains unchanged after sharing its calculation", async () => {
  const fixture = setUpCostApi();

  await fixture.commands.get("subagent-cost").handler("", fixture.ctx);

  assert.equal(
    fixture.messages.at(-1).content,
    [
      "Subagent cost",
      "",
      "Parent: ↑100 ↓10 $1.2500 (1 turn)",
      "Child 1 (worker): ↑10 ↓5 $0.4200 (1 turn)",
      "────────────────────────────",
      "Children: ↑10 ↓5 $0.4200 (1 turn)",
      "Total: ↑110 ↓15 $1.6700 (2 turns)",
    ].join("\n"),
  );
  fixture.registration.dispose();
});

test("patch application is idempotent", () => {
  const first = spawnSync(
    ".pi/agent/bin/apply-pi-subagents-child-cost.mjs",
    [],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const second = spawnSync(
    ".pi/agent/bin/apply-pi-subagents-child-cost.mjs",
    [],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /already applied/);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already applied/);
});
