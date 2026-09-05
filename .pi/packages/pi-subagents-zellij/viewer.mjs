#!/usr/bin/env node
import { sanitizeTerminal } from "./lib/protocol.mjs";
import { requestDashboard } from "./lib/client.mjs";
import { DashboardState, GuidanceDraft } from "./lib/ui-state.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if ((key !== "--socket" && key !== "--token") || !value) throw new Error("Usage: viewer.mjs --socket PATH --token TOKEN");
    result[key.slice(2)] = value;
  }
  if (!result.socket || !result.token) throw new Error("Usage: viewer.mjs --socket PATH --token TOKEN");
  return result;
}

const args = parseArgs(process.argv.slice(2));
const state = new DashboardState();
let polling = false;
let stopped = false;
let inputMode;
let inputText = "";
let broadcastPending;
let draft;
const lifetime = new AbortController();

function request(method, params = {}) {
  return requestDashboard({ socketPath: args.socket, token: args.token, method, params, signal: lifetime.signal });
}

function fit(value, width) {
  const safe = sanitizeTerminal(String(value)).replace(/[\r\n]/g, " ");
  if (safe.length <= width) return safe.padEnd(width);
  return `${safe.slice(0, Math.max(0, width - 1))}…`;
}

function wrap(value, width, maxLines) {
  const lines = sanitizeTerminal(String(value)).split(/\r?\n/);
  const output = [];
  for (const line of lines) {
    if (!line) output.push("");
    else for (let offset = 0; offset < line.length; offset += width) output.push(line.slice(offset, offset + width));
    if (output.length >= maxLines) break;
  }
  return output.slice(-maxLines);
}

function render() {
  if (stopped) return;
  const width = Math.max(40, process.stdout.columns ?? 100);
  const height = Math.max(12, process.stdout.rows ?? 30);
  const left = Math.min(38, Math.max(24, Math.floor(width * 0.34)));
  const right = Math.max(10, width - left - 3);
  const bodyRows = height - 5;
  const selected = state.selected();
  const transcript = wrap(state.transcript || "No transcript selected.", right, bodyRows);
  const selectedIndex = Math.max(0, state.items.findIndex((item) => item.id === state.selectedId));
  const itemStart = Math.max(0, Math.min(selectedIndex - Math.floor(bodyRows / 2), state.items.length - bodyRows));
  const rows = [];
  rows.push(`\x1b[1;36mpi-subagents Zellij companion\x1b[0m  ${fit(state.status, Math.max(0, width - 34))}`);
  rows.push(fit("Runs and children", left) + " │ " + fit(selected ? `${selected.kind}: ${selected.label}` : "Transcript", right));
  for (let row = 0; row < bodyRows; row += 1) {
    const item = state.items[itemStart + row];
    const prefix = item?.id === state.selectedId ? "> " : "  ";
    const indent = item?.kind === "child" ? "  " : "";
    const itemText = item ? `${prefix}${indent}${item.label} · ${item.state}` : "";
    rows.push(fit(itemText, left) + " │ " + fit(transcript[row] ?? "", right));
  }
  rows.push(fit(state.receipt || "↑↓/jk select · r refresh · s steer · tab mode · q close", width));
  if (inputMode) {
    const prompt = draft?.sending ? "Sending guidance…" : broadcastPending ? "Broadcast to all eligible children? y/N" : `Guidance (${inputMode})> ${inputText}`;
    rows.push(fit(prompt, width));
  } else rows.push(fit("Closing this dashboard does not stop agents.", width));
  process.stdout.write(`\x1b[H${rows.slice(0, height).join("\n")}`);
}

async function loadTranscript() {
  if (stopped) return;
  const item = state.selected();
  if (!item) return;
  const generation = state.beginSelectionChange(item.id);
  render();
  try {
    const data = await request("transcript", { runId: item.runId, ...(item.kind === "child" ? { childId: item.childId } : {}), lines: 160 });
    state.applyTranscript(generation, data.text || "No transcript output yet.");
  } catch (error) {
    state.applyTranscript(generation, `Transcript unavailable: ${sanitizeTerminal(error.message)}`);
  }
  render();
}

async function poll() {
  if (polling || stopped) return;
  polling = true;
  try {
    const data = await request("snapshot");
    state.applySnapshot(data.snapshot);
    const omitted = Number(data.snapshot?.omitted?.runs ?? 0) + Number(data.snapshot?.omitted?.children ?? 0);
    state.status = `${data.snapshot?.runs?.length ?? 0} async runs${omitted > 0 ? ` · ${omitted} entries omitted` : ""} · connected`;
    await loadTranscript();
  } catch (error) {
    state.status = `Disconnected: ${sanitizeTerminal(error.message)}`;
  } finally {
    polling = false;
    render();
  }
}

async function sendGuidance(broadcastConfirmed = false) {
  const currentDraft = draft;
  if (!currentDraft || currentDraft.sending) return;
  try {
    const submission = currentDraft.begin(state.selected(), inputText, inputMode);
    if (!submission) return;
    render();
    const data = await request("steer", { ...submission, broadcastConfirmed });
    const receipt = data.receipt;
    state.receipt = `${receipt.deliveryStatus}: ${receipt.state}${receipt.requestId ? ` · ${receipt.requestId}` : ""}`;
    inputMode = undefined;
    inputText = "";
    broadcastPending = undefined;
  } catch (error) {
    if (error.code === "confirmation_required") {
      broadcastPending = true;
    } else {
      state.receipt = `error: ${sanitizeTerminal(error.message)}`;
      inputMode = undefined;
      inputText = "";
      broadcastPending = undefined;
    }
  } finally {
    currentDraft.finish();
    if (!inputMode) draft = undefined;
  }
  render();
}

function move(delta) {
  if (!state.items.length) return;
  const current = Math.max(0, state.items.findIndex((item) => item.id === state.selectedId));
  const next = Math.max(0, Math.min(state.items.length - 1, current + delta));
  if (state.items[next]?.id !== state.selectedId) {
    state.selectedId = state.items[next].id;
    void loadTranscript();
  }
}

function onInput(data) {
  if (data === "\x03") return cleanup();
  if (draft?.sending) return;
  if (broadcastPending) {
    if (data === "y" || data === "Y") void sendGuidance(true);
    else {
      state.receipt = "Broadcast cancelled.";
      inputMode = undefined;
      inputText = "";
      broadcastPending = undefined;
      render();
    }
    return;
  }
  if (inputMode) {
    if (data === "\r" || data === "\n") {
      if (inputText.trim()) void sendGuidance(false);
    } else if (data === "\x1b") {
      inputMode = undefined;
      inputText = "";
      render();
    } else if (data === "\x7f") {
      inputText = inputText.slice(0, -1);
      render();
    } else if (data === "\t") {
      inputMode = inputMode === "steer" ? "follow_up" : inputMode === "follow_up" ? "auto" : "steer";
      render();
    } else if (!/[\x00-\x1f\x7f]/.test(data) && Buffer.byteLength(inputText + data, "utf8") <= 8 * 1024) {
      inputText += data;
      render();
    }
    return;
  }
  if (data === "q" || data === "\x03") return cleanup();
  if (data === "j" || data === "\x1b[B") move(1);
  else if (data === "k" || data === "\x1b[A") move(-1);
  else if (data === "r") void poll();
  else if (data === "s") {
    try {
      draft = new GuidanceDraft(state.selected());
      inputMode = "steer";
      inputText = "";
    } catch (error) {
      state.receipt = sanitizeTerminal(error.message);
    }
    render();
  }
}

function cleanup() {
  if (stopped) return;
  stopped = true;
  lifetime.abort();
  clearInterval(timer);
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  process.stdout.write("\x1b[?25h\x1b[?1049l");
  process.exitCode = 0;
}

process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
process.stdin.setEncoding("utf8");
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", onInput);
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", () => process.stdout.write("\x1b[?25h\x1b[?1049l"));
const timer = setInterval(() => void poll(), 2000);
void poll();
