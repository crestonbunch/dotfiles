import { basename } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const ICON = {
  model: "",
  effort: "",
  context: "",
  session: "",
  week: "",
  reset: "",
  directory: "",
  revision: "⬡",
  branch: "",
  pullRequest: "",
  input: "",
  output: "",
  cost: "",
} as const;

const FILLED = "▰";
const EMPTY = "▱";
const SEPARATOR = " · ";

type Theme = {
  fg: (color: "dim" | "muted" | "warning" | "error", text: string) => string;
  bold: (text: string) => string;
};

type RateLimit = {
  percent: number;
  resetsAt?: number;
};

type Location = {
  bookmark: string;
  revision: string;
  pullRequest?: { number: number; url: string };
};

const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
};

const relativeReset = (resetsAt: number | undefined): string => {
  if (resetsAt === undefined) return "";
  const seconds = Math.max(0, Math.floor(resetsAt - Date.now() / 1000));
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.ceil(seconds / 60)}m`;
};

const join = (theme: Theme, parts: Array<string | undefined>): string =>
  parts.filter((part): part is string => Boolean(part)).join(theme.fg("dim", SEPARATOR));

const bar = (theme: Theme, percent: number, segments: number): string => {
  const boundedPercent = Math.max(0, Math.min(100, percent));
  const filled = Math.round((boundedPercent / 100) * segments);
  const text = FILLED.repeat(filled) + EMPTY.repeat(segments - filled);
  if (boundedPercent >= 90) return theme.fg("error", text);
  if (boundedPercent >= 70) return theme.fg("warning", text);
  return theme.fg("dim", text);
};

const align = (left: string, right: string, width: number): string => {
  if (!right) return truncateToWidth(left, width, "");

  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  if (leftWidth + rightWidth + 1 <= width) {
    return left + " ".repeat(width - leftWidth - rightWidth) + right;
  }

  if (leftWidth >= width) return truncateToWidth(left, width, "");
  const availableRight = Math.max(0, width - leftWidth - 1);
  const clippedRight = truncateToWidth(right, availableRight, "");
  return left + " ".repeat(Math.max(1, width - leftWidth - visibleWidth(clippedRight))) + clippedRight;
};

const parseNumber = (headers: Record<string, string>, names: string[]): number | undefined => {
  for (const name of names) {
    const value = Number.parseFloat(headers[name] ?? "");
    if (Number.isFinite(value)) return value;
  }
  return undefined;
};

const readRateLimit = (
  headers: Record<string, string>,
  prefix: "primary" | "secondary",
): RateLimit | undefined => {
  const percent = parseNumber(headers, [
    `x-codex-${prefix}-used-percent`,
    `x-openai-${prefix}-used-percent`,
  ]);
  if (percent === undefined) return undefined;

  const resetAfter = parseNumber(headers, [
    `x-codex-${prefix}-reset-after-seconds`,
    `x-openai-${prefix}-reset-after-seconds`,
  ]);
  const resetAt = parseNumber(headers, [
    `x-codex-${prefix}-reset-at`,
    `x-openai-${prefix}-reset-at`,
  ]);

  return {
    percent,
    resetsAt: resetAt ?? (resetAfter === undefined ? undefined : Date.now() / 1000 + resetAfter),
  };
};

const rateSegment = (theme: Theme, icon: string, limit: RateLimit | undefined): string => {
  if (!limit) return "";
  const reset = relativeReset(limit.resetsAt);
  const resetText = reset ? ` ${theme.fg("dim", ICON.reset)} ${theme.fg("dim", reset)}` : "";
  return `${theme.fg("dim", icon)} ${bar(theme, limit.percent, 10)} ${Math.round(limit.percent)}%${resetText}`;
};

export default (pi: ExtensionAPI) => {
  let location: Location = { bookmark: "", revision: "" };
  let sessionLimit: RateLimit | undefined;
  let weekLimit: RateLimit | undefined;
  let requestRender: (() => void) | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshActive = false;
  let refreshAgain = false;
  let lastPullRequestRefresh = 0;
  let alive = false;

  const refreshLocation = async (cwd: string, includePullRequest: boolean): Promise<void> => {
    if (refreshActive) {
      refreshAgain = true;
      return;
    }
    refreshActive = true;

    try {
      const [bookmarkResult, revisionResult] = await Promise.all([
        pi.exec("jj", ["--ignore-working-copy", "--no-pager", "bbt"], { cwd, timeout: 2000 }),
        pi.exec(
          "jj",
          ["--ignore-working-copy", "--no-pager", "log", "--no-graph", "-r", "@", "-T", "change_id.shortest(8)"],
          { cwd, timeout: 2000 },
        ),
      ]);
      if (!alive) return;

      const bookmark = bookmarkResult.code === 0 ? (bookmarkResult.stdout.split("\n")[0] ?? "").trim() : "";
      const revision = revisionResult.code === 0 ? revisionResult.stdout.trim() : "";
      const next: Location = { bookmark, revision };

      const now = Date.now();
      if (includePullRequest && bookmark && now - lastPullRequestRefresh >= 30_000) {
        lastPullRequestRefresh = now;
        const result = await pi.exec("gh", ["pr", "view", bookmark, "--json", "number,url"], {
          cwd,
          timeout: 5000,
        });
        if (result.code === 0) {
          try {
            const pullRequest = JSON.parse(result.stdout) as { number?: unknown; url?: unknown };
            if (typeof pullRequest.number === "number" && typeof pullRequest.url === "string") {
              next.pullRequest = { number: pullRequest.number, url: pullRequest.url };
            }
          } catch {}
        }
      } else if (bookmark === location.bookmark) {
        next.pullRequest = location.pullRequest;
      }

      if (!alive) return;
      location = next;
      requestRender?.();
    } catch {
      if (!alive) return;
      location = { bookmark: "", revision: "" };
      requestRender?.();
    } finally {
      refreshActive = false;
      if (refreshAgain && alive) {
        refreshAgain = false;
        void refreshLocation(cwd, false);
      }
    }
  };

  const scheduleLocationRefresh = (cwd: string, includePullRequest: boolean): void => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refreshLocation(cwd, includePullRequest);
    }, 150);
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    alive = true;

    ctx.ui.setFooter((tui, theme) => {
      requestRender = () => tui.requestRender();

      return {
        invalidate: () => {},
        dispose: () => {
          requestRender = undefined;
        },
        render: (width: number): string[] => {
          let input = 0;
          let output = 0;
          let cost = 0;
          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type !== "message" || entry.message.role !== "assistant") continue;
            const message = entry.message as AssistantMessage;
            input += message.usage.input;
            output += message.usage.output;
            cost += message.usage.cost.total;
          }

          const context = ctx.getContextUsage();
          const contextPercent = context?.percent;
          const contextWindow = context?.contextWindow ?? ctx.model?.contextWindow;
          const model = ctx.model?.name ?? ctx.model?.id ?? "unknown";
          const thinking = ctx.model?.reasoning ? ctx.thinkingLevel : undefined;
          const directory = basename(ctx.cwd);
          const pullRequest = location.pullRequest;
          const pullRequestLink = pullRequest
            ? `\u001b]8;;${pullRequest.url}\u001b\\#${pullRequest.number}\u001b]8;;\u001b\\`
            : undefined;

          const line1Left = join(theme, [
            `${theme.fg("dim", ICON.model)} ${theme.bold(model)}`,
            thinking ? `${theme.fg("dim", ICON.effort)} ${thinking}` : undefined,
          ]);
          const line1Right = join(theme, [
            `${theme.fg("dim", ICON.directory)} ${directory}`,
            location.revision ? theme.fg("dim", `${ICON.revision} ${location.revision}`) : undefined,
          ]);

          const contextSegment =
            contextPercent !== undefined && contextPercent !== null && contextWindow
              ? `${theme.fg("dim", ICON.context)} ${bar(theme, contextPercent, 5)} ${Math.round(contextPercent)}% ${theme.fg("dim", `${Math.floor(contextWindow / 1000)}k`)}`
              : undefined;
          const tokenSegment =
            input > 0 || output > 0
              ? `${theme.fg("dim", ICON.input)} ${formatTokens(input)} ${theme.fg("dim", ICON.output)} ${formatTokens(output)}`
              : undefined;
          const costSegment = cost > 0 ? `${theme.fg("dim", ICON.cost)} ${cost.toFixed(2)}` : undefined;
          const line2Left = join(theme, [contextSegment, tokenSegment, costSegment]);
          const line2Right = join(theme, [
            location.bookmark ? `${theme.fg("dim", ICON.branch)} ${location.bookmark}` : undefined,
            pullRequestLink ? `${theme.fg("dim", ICON.pullRequest)} ${pullRequestLink}` : undefined,
          ]);

          const lines = [align(line1Left, line1Right, width), align(line2Left, line2Right, width)];
          const session = rateSegment(theme, ICON.session, sessionLimit);
          const week = rateSegment(theme, ICON.week, weekLimit);
          if (session || week) lines.push(align(session, week, width));
          return lines;
        },
      };
    });

    scheduleLocationRefresh(ctx.cwd, true);
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    if (ctx.mode === "tui") scheduleLocationRefresh(ctx.cwd, false);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.mode === "tui") scheduleLocationRefresh(ctx.cwd, true);
  });

  pi.on("model_select", () => requestRender?.());
  pi.on("thinking_level_select", () => requestRender?.());

  pi.on("after_provider_response", (event) => {
    const headers = Object.fromEntries(
      Object.entries(event.headers).map(([name, value]) => [name.toLowerCase(), value]),
    );
    sessionLimit = readRateLimit(headers, "primary") ?? sessionLimit;
    weekLimit = readRateLimit(headers, "secondary") ?? weekLimit;
    requestRender?.();
  });

  pi.on("session_shutdown", () => {
    alive = false;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    requestRender = undefined;
  });
};
