import { randomUUID } from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const BASE_TITLE = "pi";
const SUCCESS_INDICATOR = "󰄬";
const ERROR_INDICATOR = "󰅖";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function zellijTabStatus(pi: ExtensionAPI): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeStatus: (() => void) | undefined;
  let frame = 0;
  let lastStopReason: AssistantMessage["stopReason"] | undefined;
  let active = false;
  let currentCtx: ExtensionContext | undefined;
  let waitingForPrompt = false;
  let subagentEventVersion = 0;
  let fleetActive = false;
  const runningSubagents = new Set<string>();
  const subscriptions: Array<() => void> = [];

  function clearSpinner(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    frame = 0;
  }

  function clearStartupTimer(): void {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = undefined;
  }

  function setTitle(ctx: ExtensionContext, indicator?: string): void {
    ctx.ui.setTitle(indicator ? `${indicator} ${BASE_TITLE}` : BASE_TITLE);
  }

  function showPaused(ctx: ExtensionContext, failed = false): void {
    clearStartupTimer();
    clearSpinner();
    setTitle(ctx, failed ? ERROR_INDICATOR : SUCCESS_INDICATOR);
  }

  function showRunning(ctx: ExtensionContext): void {
    clearStartupTimer();
    if (timer) return;
    const update = (): void => {
      setTitle(ctx, SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
      frame += 1;
    };
    update();
    timer = setInterval(update, 80);
  }

  const updateStatus = (ctx: ExtensionContext): void => {
    if (!active || ctx.mode !== "tui") return;
    if (fleetActive || runningSubagents.size > 0 || (!waitingForPrompt && !ctx.isIdle())) {
      showRunning(ctx);
    } else {
      const failed = lastStopReason === "error" || lastStopReason === "aborted" || lastStopReason === "length";
      showPaused(ctx, !waitingForPrompt && failed);
    }
  };

  const refreshSubagents = (ctx: ExtensionContext): void => {
    unsubscribeStatus?.();
    const requestId = randomUUID();
    const eventVersion = subagentEventVersion;
    unsubscribeStatus = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (data) => {
      if (!active || !data || typeof data !== "object") return;
      const reply = data as {
        version?: unknown;
        requestId?: unknown;
        success?: unknown;
        data?: {
          fleet?: { version?: unknown; totalActive?: unknown };
          asyncSnapshot?: { kind?: unknown; version?: unknown; runs?: unknown };
        };
      };
      if (reply.version !== 1 || reply.requestId !== requestId || reply.success !== true || eventVersion !== subagentEventVersion) return;
      const snapshot = reply.data?.asyncSnapshot;
      if (snapshot?.kind !== "pi-subagents.async-status-snapshot" || snapshot.version !== 1 || !Array.isArray(snapshot.runs)) return;
      const fleet = reply.data?.fleet;
      fleetActive = fleet?.version === 1 && typeof fleet.totalActive === "number" && fleet.totalActive > 0;
      runningSubagents.clear();
      for (const run of snapshot.runs) {
        if (run && typeof run.id === "string" && (run.state === "running" || run.state === "queued")) {
          runningSubagents.add(run.id);
        }
      }
      updateStatus(ctx);
    });
    // The public session-scoped snapshot also recovers reloads and missed events.
    pi.events.emit("subagents:rpc:v1:request", {
      version: 1,
      requestId,
      method: "status",
      params: {},
      source: { extension: "zellij-pane-title" },
    });
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !process.env.ZELLIJ) return;
    active = true;
    currentCtx = ctx;
    // Track run identities, not child counts: parallel workflows finish as one run.
    subscriptions.push(
      pi.events.on("subagent:async-started", (data) => {
        if (!currentCtx || !data || typeof data !== "object") return;
        const run = data as { id?: unknown; sessionId?: unknown };
        if (run.sessionId !== currentCtx.sessionManager.getSessionId()) return;
        if (typeof run.id !== "string" || !run.id) return;
        subagentEventVersion += 1;
        runningSubagents.add(run.id);
        updateStatus(currentCtx);
      }),
      pi.events.on("subagent:async-complete", (data) => {
        if (!currentCtx || !data || typeof data !== "object") return;
        const run = data as { runId?: unknown; id?: unknown };
        const id = run.runId ?? run.id;
        if (typeof id !== "string" || !runningSubagents.delete(id)) return;
        subagentEventVersion += 1;
        updateStatus(currentCtx);
      }),
    );
    startupTimer = setTimeout(() => {
      updateStatus(ctx);
      refreshSubagents(ctx);
    }, 0);
    statusTimer = setInterval(() => refreshSubagents(ctx), 2000);
  });

  pi.on("agent_start", (_event, ctx) => {
    lastStopReason = undefined;
    if (active && ctx.mode === "tui") showRunning(ctx);
  });

  pi.on("ui_prompt_start", (_event, ctx) => {
    waitingForPrompt = true;
    updateStatus(ctx);
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    waitingForPrompt = false;
    updateStatus(ctx);
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      lastStopReason = event.message.stopReason;
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (!active || ctx.mode !== "tui") return;
    active = false;
    currentCtx = undefined;
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = undefined;
    unsubscribeStatus?.();
    unsubscribeStatus = undefined;
    waitingForPrompt = false;
    lastStopReason = undefined;
    runningSubagents.clear();
    fleetActive = false;
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    clearStartupTimer();
    clearSpinner();
    setTitle(ctx);
  });
}
