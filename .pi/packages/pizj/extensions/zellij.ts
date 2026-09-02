import type { RunCommand } from "./types.ts";
import { requireSuccess } from "./runtime.ts";

interface ZellijPane {
  id: number;
  is_plugin: boolean;
  tab_id: number;
  pane_cwd?: string;
}

const paneId = (value: string | undefined): string => (value ?? "").replace(/^terminal_/, "");

export const findCurrentTab = async (
  run: RunCommand,
  session: string,
  currentPaneId: string,
): Promise<number> => {
  const output = await requireSuccess(run, "zellij", ["--session", session, "action", "list-panes", "--all", "--json"]);
  const panes = JSON.parse(output) as ZellijPane[];
  const pane = panes.find((candidate) => !candidate.is_plugin && String(candidate.id) === paneId(currentPaneId));
  if (!pane) throw new Error(`Cannot find zellij pane ${currentPaneId} in session ${session}`);
  return pane.tab_id;
};

export const openPane = async (
  run: RunCommand,
  input: {
    session: string;
    tabId: number;
    cwd: string;
    label: string;
    environment: Record<string, string>;
    command: string[];
    nearCurrentPane?: boolean;
  },
): Promise<string> => {
  const environmentArgs = Object.entries(input.environment).map(([name, value]) => `${name}=${value}`);
  const targetArgs = input.nearCurrentPane ? ["--near-current-pane"] : ["--tab-id", String(input.tabId)];
  const output = await requireSuccess(run, "zellij", [
    "--session", input.session, "action", "new-pane", ...targetArgs, "--stacked",
    "--no-focus", "--close-on-exit", "--name", input.label, "--cwd", input.cwd, "--",
    "env", ...environmentArgs, ...input.command,
  ]);
  return output.replace(/^terminal_/, "").trim();
};

export const openTab = async (
  run: RunCommand,
  input: {
    session: string;
    cwd: string;
    name: string;
    environment?: Record<string, string>;
    command?: string[];
  },
): Promise<number> => {
  const commandArgs = input.command
    ? ["--close-on-exit", "--", "env", ...Object.entries(input.environment ?? {}).map(([name, value]) => `${name}=${value}`), ...input.command]
    : [];
  const output = await requireSuccess(run, "zellij", [
    "--session", input.session, "action", "new-tab", "--no-focus", "--name", input.name,
    "--cwd", input.cwd, ...commandArgs,
  ]);
  return Number.parseInt(output, 10);
};

export const closeOtherTerminalPanes = async (
  run: RunCommand,
  session: string,
  tabId: number,
  keepPaneId: string,
): Promise<void> => {
  const output = await requireSuccess(run, "zellij", ["--session", session, "action", "list-panes", "--all", "--json"]);
  const panes = JSON.parse(output) as ZellijPane[];
  const otherIds = panes
    .filter((pane) => !pane.is_plugin && pane.tab_id === tabId && String(pane.id) !== paneId(keepPaneId))
    .map((pane) => String(pane.id));
  for (const id of otherIds) await closePane(run, session, id);
};

export const closePane = async (run: RunCommand, session: string, id: string): Promise<void> => {
  const result = await run("zellij", ["--session", session, "action", "close-pane", "--pane-id", id]);
  if (result.code === 0 || /not found|no pane|unknown pane/i.test(`${result.stderr}\n${result.stdout}`)) return;
  throw new Error(`Cannot close zellij pane ${id}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
};

export const closeTab = async (run: RunCommand, session: string, id: number): Promise<void> => {
  const output = await requireSuccess(run, "zellij", ["--session", session, "action", "list-tabs", "--all", "--json"]);
  const tabs = JSON.parse(output) as Array<{ tab_id: number }>;
  if (!tabs.some((tab) => tab.tab_id === id)) return;
  await requireSuccess(run, "zellij", ["--session", session, "action", "close-tab-by-id", String(id)]);
};
