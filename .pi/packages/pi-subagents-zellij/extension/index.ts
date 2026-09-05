import { createHash, randomBytes } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDashboardHandler, createEventRpc, startSocketBridge } from "../lib/bridge.mjs";
import { sanitizeTerminal } from "../lib/protocol.mjs";
import { createZellijClient, findCapturedTab, findVerifiedPane } from "../lib/zellij.mjs";

interface Binding {
  version: 1;
  sessionName: string;
  tabId: number;
  paneId: string;
  title: string;
}

interface SessionRuntime {
  identity: string;
  hash: string;
  directory: string;
  socketPath: string;
  token: string;
  sessionName: string;
  tabId: number;
  cwd: string;
  title: string;
  rpc: ReturnType<typeof createEventRpc>;
  bridge: Awaited<ReturnType<typeof startSocketBridge>>;
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe dashboard state directory: ${path}`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`Dashboard state directory is not owned by this user: ${path}`);
  chmodSync(path, 0o700);
}

function assertPrivateFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe dashboard state file: ${path}`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`Dashboard state file is not owned by this user: ${path}`);
}

function readOrCreateToken(directory: string): string {
  privateDirectory(directory);
  const path = join(directory, "token");
  try {
    assertPrivateFile(path);
    const token = readFileSync(path, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error(`Invalid dashboard session token: ${path}`);
    chmodSync(path, 0o600);
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, `${token}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return token;
}

function readBinding(directory: string): Binding | undefined {
  const path = join(directory, "pane.json");
  try {
    assertPrivateFile(path);
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Binding>;
    if (value.version !== 1 || typeof value.sessionName !== "string" || !Number.isSafeInteger(value.tabId) || typeof value.paneId !== "string" || typeof value.title !== "string") return undefined;
    return value as Binding;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function writeBinding(directory: string, binding: Binding): void {
  const target = join(directory, "pane.json");
  const temporary = join(directory, `pane-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(binding)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
}

function sessionIdentity(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
}

async function initialize(pi: ExtensionAPI, ctx: ExtensionContext): Promise<SessionRuntime> {
  const identity = sessionIdentity(ctx);
  if (!identity) throw new Error("Pi did not provide a session identity.");
  const sessionName = process.env.ZELLIJ_SESSION_NAME;
  const currentPaneId = process.env.ZELLIJ_PANE_ID;
  if (!sessionName || !currentPaneId) throw new Error("Zellij did not provide session and pane identity.");
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 32);
  // Keep the Unix socket path below common sun_path limits on macOS and Linux.
  const root = join("/tmp", `pi-saz-${typeof process.getuid === "function" ? process.getuid() : "user"}`);
  privateDirectory(root);
  const directory = join(root, hash);
  const token = readOrCreateToken(directory);
  const zellij = createZellijClient();
  const panes = await zellij.list(sessionName);
  const tabId = findCapturedTab(panes, currentPaneId);
  if (tabId === undefined) throw new Error("Could not resolve the current Zellij pane to one unambiguous tab.");
  const rpc = createEventRpc(pi.events);
  const socketPath = join(directory, "rpc.sock");
  const bridge = await startSocketBridge({ socketPath, handler: createDashboardHandler({ rpc, token }) });
  return { identity, hash, directory, socketPath, token, sessionName, tabId, cwd: ctx.cwd, title: `subagents · ${hash.slice(0, 8)}`, rpc, bridge };
}

export default function subagentsZellij(pi: ExtensionAPI): void {
  let runtime: SessionRuntime | undefined;
  let startupError: string | undefined;
  let generation = 0;
  let opening: Promise<void> | undefined;
  const zellij = createZellijClient();
  const viewerPath = fileURLToPath(new URL("../viewer.mjs", import.meta.url));

  async function stopRuntime(): Promise<void> {
    generation += 1;
    const current = runtime;
    runtime = undefined;
    if (!current) return;
    current.rpc.close();
    await current.bridge.close();
  }

  async function openNow(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("The Zellij dashboard is available only in Pi TUI mode.", "warning");
      return;
    }
    if (!process.env.ZELLIJ_SESSION_NAME || !process.env.ZELLIJ_PANE_ID) {
      ctx.ui.notify("The Zellij dashboard requires Pi to run inside Zellij.", "warning");
      return;
    }
    if (!runtime) {
      ctx.ui.notify(`Zellij dashboard unavailable${startupError ? `: ${startupError}` : "."}`, "error");
      return;
    }
    if (sessionIdentity(ctx) !== runtime.identity) {
      ctx.ui.notify("Zellij dashboard session changed; reload before opening it.", "error");
      return;
    }

    const saved = readBinding(runtime.directory);
    if (saved && saved.sessionName === runtime.sessionName && saved.title === runtime.title) {
      try {
        if (await zellij.focus(saved)) return;
      } catch (error) {
        ctx.ui.notify(`Saved dashboard pane could not be focused: ${sanitizeTerminal(error instanceof Error ? error.message : String(error))}`, "warning");
      }
    }

    const bindingBase = { version: 1 as const, sessionName: runtime.sessionName, tabId: runtime.tabId, title: runtime.title };
    try {
      const paneId = await zellij.open({
        ...bindingBase,
        cwd: runtime.cwd,
        nodePath: process.execPath,
        viewerPath,
        socketPath: runtime.socketPath,
        token: runtime.token,
      });
      const binding: Binding = { ...bindingBase, paneId };
      let verified = false;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const panes = await zellij.list(runtime.sessionName);
        if (findVerifiedPane(panes, binding)) {
          verified = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!verified) throw new Error(`Created pane ${paneId} could not be verified in tab ${runtime.tabId}.`);
      writeBinding(runtime.directory, binding);
    } catch (error) {
      ctx.ui.notify(`Could not open Zellij dashboard: ${sanitizeTerminal(error instanceof Error ? error.message : String(error))}`, "error");
    }
  }

  async function open(ctx: ExtensionContext): Promise<void> {
    if (opening) return opening;
    const task = openNow(ctx).finally(() => {
      if (opening === task) opening = undefined;
    });
    opening = task;
    return task;
  }

  pi.registerCommand("subagents-zellij", {
    description: "Open or focus the standalone Zellij subagent dashboard",
    handler: async (_args, ctx) => open(ctx),
  });

  pi.registerShortcut("ctrl+alt+z", {
    description: "Open or focus the Zellij subagent dashboard",
    handler: async (ctx) => open(ctx),
  });

  pi.on("session_start", async (_event, ctx) => {
    await stopRuntime();
    startupError = undefined;
    if (ctx.mode !== "tui" || !process.env.ZELLIJ_SESSION_NAME || !process.env.ZELLIJ_PANE_ID) return;
    const currentGeneration = ++generation;
    try {
      const next = await initialize(pi, ctx);
      if (generation !== currentGeneration) {
        next.rpc.close();
        await next.bridge.close();
        return;
      }
      runtime = next;
      ctx.ui.setStatus("subagents-zellij", ctx.ui.theme.fg("dim", "Ctrl+Alt+Z dashboard"));
    } catch (error) {
      startupError = sanitizeTerminal(error instanceof Error ? error.message : String(error));
      ctx.ui.setStatus("subagents-zellij", ctx.ui.theme.fg("warning", "dashboard unavailable"));
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("subagents-zellij", undefined);
    await stopRuntime();
  });
}
