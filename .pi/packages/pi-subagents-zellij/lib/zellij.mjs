import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SAFE_SESSION = /^[^\0\r\n]{1,256}$/;
const PANE_ID = /^terminal_(0|[1-9][0-9]*)$/;

export function parseCreatedPaneId(output) {
  const value = String(output).trim();
  if (!PANE_ID.test(value)) throw new Error(`Zellij returned an invalid pane id: ${value || "(empty)"}`);
  return value;
}

export function buildListArgv(sessionName) {
  if (!SAFE_SESSION.test(sessionName)) throw new Error("Invalid Zellij session name.");
  return ["--session", sessionName, "action", "list-panes", "--json"];
}

export function buildFocusArgv(sessionName, paneId) {
  if (!PANE_ID.test(paneId)) throw new Error("Invalid Zellij pane id.");
  return ["--session", sessionName, "action", "focus-pane-id", paneId];
}

export function buildOpenArgv({ sessionName, tabId, cwd, title, nodePath, viewerPath, socketPath, token }) {
  if (!SAFE_SESSION.test(sessionName)) throw new Error("Invalid Zellij session name.");
  if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error("Invalid Zellij tab id.");
  for (const [label, value] of Object.entries({ cwd, title, nodePath, viewerPath, socketPath, token })) {
    if (typeof value !== "string" || !value || /[\0\r\n]/.test(value)) throw new Error(`Invalid ${label}.`);
  }
  return [
    "--session", sessionName,
    "action", "new-pane",
    "--tab-id", String(tabId),
    "--close-on-exit",
    "--cwd", cwd,
    "--name", title,
    "--",
    nodePath, viewerPath,
    "--socket", socketPath,
    "--token", token,
  ];
}

function normalizePaneId(pane) {
  if (pane?.is_plugin === true || !Number.isSafeInteger(pane?.id) || pane.id < 0) return undefined;
  return `terminal_${pane.id}`;
}

export function findVerifiedPane(panes, binding) {
  if (!Array.isArray(panes)) return undefined;
  const matches = panes.filter((pane) =>
    normalizePaneId(pane) === binding.paneId
    && pane.tab_id === binding.tabId
    && pane.title === binding.title
    && pane.exited === false,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function findCapturedTab(panes, currentPaneId) {
  if (!/^(0|[1-9][0-9]*)$/.test(currentPaneId) || !Array.isArray(panes)) return undefined;
  const matches = panes.filter((pane) => pane?.is_plugin === false && pane.id === Number(currentPaneId) && pane.exited === false);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]?.tab_id)) return undefined;
  return matches[0].tab_id;
}

export function createZellijClient(options = {}) {
  const binary = options.binary ?? "zellij";
  const run = options.execFile ?? (async (args) => execFile(binary, args, { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true }));
  async function execute(args) {
    const result = await run(args);
    return typeof result === "string" ? { stdout: result, stderr: "" } : result;
  }
  async function list(sessionName) {
    const { stdout } = await execute(buildListArgv(sessionName));
    const panes = JSON.parse(stdout);
    if (!Array.isArray(panes)) throw new Error("Zellij pane list was not an array.");
    return panes;
  }
  return {
    list,
    async focus(binding) {
      const panes = await list(binding.sessionName);
      if (!findVerifiedPane(panes, binding)) return false;
      await execute(buildFocusArgv(binding.sessionName, binding.paneId));
      return true;
    },
    async open(options) {
      const { stdout } = await execute(buildOpenArgv(options));
      return parseCreatedPaneId(stdout);
    },
  };
}
