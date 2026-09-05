import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const BASE_TITLE = "pi";
const SUCCESS_INDICATOR = "󰄬";
const ERROR_INDICATOR = "󰅖";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function zellijTabStatus(pi: ExtensionAPI): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let lastStopReason: AssistantMessage["stopReason"] | undefined;
  let active = false;

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
    clearSpinner();
    const update = (): void => {
      setTitle(ctx, SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
      frame += 1;
    };
    update();
    timer = setInterval(update, 80);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !process.env.ZELLIJ) return;
    active = true;
    startupTimer = setTimeout(() => {
      if (ctx.isIdle()) showPaused(ctx);
      else showRunning(ctx);
    }, 0);
  });

  pi.on("agent_start", (_event, ctx) => {
    lastStopReason = undefined;
    if (active && ctx.mode === "tui") showRunning(ctx);
  });

  pi.on("ui_prompt_start", (_event, ctx) => {
    if (active && ctx.mode === "tui") showPaused(ctx);
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    if (!active || ctx.mode !== "tui") return;
    if (ctx.isIdle()) showPaused(ctx);
    else showRunning(ctx);
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      lastStopReason = event.message.stopReason;
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!active || ctx.mode !== "tui") return;
    const failed = lastStopReason === "error" || lastStopReason === "aborted" || lastStopReason === "length";
    showPaused(ctx, failed);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (!active || ctx.mode !== "tui") return;
    active = false;
    clearStartupTimer();
    clearSpinner();
    setTitle(ctx);
  });
}
