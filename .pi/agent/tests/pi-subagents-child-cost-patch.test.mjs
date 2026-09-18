import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
const { getArtifactPaths, getArtifactsDir } = await jiti.import(
  "../npm/node_modules/pi-subagents/src/shared/artifacts.ts",
);
const { DIRS } = await jiti.import(
  "../npm/node_modules/pi-subagents/src/shared/types.ts",
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

const defaultBranch = () => {
  const childResult = { agent: "worker", runId: "child-1", usage: childUsage };
  return [
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
  ];
};

const setUpCostApi = ({
  branch = defaultBranch(),
  sessionFile = null,
  sessionId = "session-1",
} = {}) => {
  const events = makeEvents();
  const commands = new Map();
  const messages = [];
  const ctx = {
    cwd: "/tmp",
    sessionManager: {
      getBranch: () => branch,
      getSessionFile: () => sessionFile,
      getSessionId: () => sessionId,
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

const emptyUsage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  input: 0,
  output: 0,
  turns: 0,
};

const setUpStandaloneAsyncCostApi = (
  t,
  { directUsage, metadataUsage, statusSessionId = "session-1" } = {},
) => {
  const runId = randomUUID();
  const root = mkdtempSync(join(tmpdir(), "pi-subagent-cost-test-"));
  const sessionFile = join(root, "parent-session.jsonl");
  const asyncDir = join(DIRS.async, runId);
  const branch = [
    {
      message: {
        details: {
          asyncId: runId,
          mode: "single",
          results: directUsage
            ? [{ agent: "delegate", runId, usage: directUsage }]
            : [],
          runId,
        },
        role: "toolResult",
        toolName: "subagent",
      },
      type: "message",
    },
  ];
  mkdirSync(asyncDir, { recursive: true });
  writeFileSync(
    join(asyncDir, "status.json"),
    JSON.stringify({
      mode: "single",
      runId,
      sessionId: statusSessionId,
      startedAt: 1,
      state: metadataUsage ? "complete" : "running",
      steps: [{ agent: "delegate", status: metadataUsage ? "complete" : "running" }],
    }),
  );
  if (metadataUsage) {
    const artifactsDir = getArtifactsDir(sessionFile, "/tmp", "session");
    const metadataPath = getArtifactPaths(
      artifactsDir,
      runId,
      "delegate",
      0,
    ).metadataPath;
    mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(
      metadataPath,
      JSON.stringify({ agent: "delegate", runId, usage: metadataUsage }),
    );
  }
  const fixture = setUpCostApi({ branch, sessionFile });
  t.after(() => {
    fixture.registration.dispose();
    rmSync(asyncDir, { force: true, recursive: true });
    rmSync(root, { force: true, recursive: true });
  });
  return fixture;
};

const requestCost = fixture => {
  let reply;
  fixture.events.on("subagents:cost:v1:reply:request-1", value => {
    reply = value;
  });
  fixture.events.emit("subagents:cost:v1:request", {
    requestId: "request-1",
    sessionId: "session-1",
    version: 1,
  });
  return reply;
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

test("cost API reports standalone async child metadata", t => {
  const usage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.021625000000000002,
    input: 4265,
    output: 10,
    turns: 1,
  };
  const fixture = setUpStandaloneAsyncCostApi(t, { metadataUsage: usage });

  const reply = requestCost(fixture);

  assert.deepEqual(reply.data.childUsage, usage);
  assert.equal(reply.data.incomplete, false);
  assert.equal(reply.data.unresolvedAsyncChildren, 0);
});

test("cost API marks standalone async usage unresolved instead of reporting a false zero", t => {
  const fixture = setUpStandaloneAsyncCostApi(t);

  const reply = requestCost(fixture);

  assert.deepEqual(reply.data.childUsage, emptyUsage);
  assert.equal(reply.data.incomplete, true);
  assert.equal(reply.data.unresolvedAsyncChildren, 1);
});

test("cost API does not read standalone async usage from another session", t => {
  const fixture = setUpStandaloneAsyncCostApi(t, {
    metadataUsage: childUsage,
    statusSessionId: "session-2",
  });

  const reply = requestCost(fixture);

  assert.deepEqual(reply.data.childUsage, emptyUsage);
  assert.equal(reply.data.incomplete, true);
  assert.equal(reply.data.unresolvedAsyncChildren, 1);
});

test("cost API deduplicates standalone metadata already present in direct results", t => {
  const fixture = setUpStandaloneAsyncCostApi(t, {
    directUsage: childUsage,
    metadataUsage: childUsage,
  });

  const reply = requestCost(fixture);

  assert.deepEqual(reply.data.childUsage, childUsage);
  assert.equal(reply.data.incomplete, false);
  assert.equal(reply.data.unresolvedAsyncChildren, 0);
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
