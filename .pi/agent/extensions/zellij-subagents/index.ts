import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Key } from '@earendil-works/pi-tui';
import { activeChildren, ZellijView } from './core.mjs';
import { findRunDir } from './artifacts.mjs';

type Snapshot = { kind: string; version: number; runs: unknown[] };
type Reply = { version?: number; requestId?: string; success?: boolean; data?: { asyncSnapshot?: Snapshot }; error?: { message?: string } };
const viewer = fileURLToPath(new URL('./viewer.mjs', import.meta.url));

export default function zellijSubagents(pi: ExtensionAPI): void {
  let ctx: ExtensionContext | undefined;
  let view: ZellijView | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let running = false;
  let again = false;
  let pendingFocus = false;
  let pendingClear = false;
  let work: Promise<void> | undefined;
  let lastWarning = '';
  let lastWarningAt = 0;
  const unsubs: (() => void)[] = [];
  const pending = new Set<() => void>();
  const hints = new Map<string, string>();

  function rpcStatus(): Promise<Snapshot> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      let done = false;
      let off = () => {};
      const finish = (error?: Error, value?: Snapshot) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        pending.delete(cancel);
        if (error) reject(error); else resolve(value!);
      };
      const cancel = () => finish(new Error('Session ended'));
      const timer = setTimeout(() => finish(new Error('pi-subagents status RPC timed out')), 3000);
      pending.add(cancel);
      off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (data) => {
        const reply = data as Reply;
        if (reply?.version !== 1 || reply.requestId !== requestId) return;
        if (!reply.success || !reply.data?.asyncSnapshot) finish(new Error(reply.error?.message ?? 'Async status projection unavailable'));
        else finish(undefined, reply.data.asyncSnapshot);
      });
      pi.events.emit('subagents:rpc:v1:request', { version: 1, requestId, method: 'status', params: {}, source: { extension: 'zellij-subagents' } });
    });
  }
  async function refresh(focus = false) {
    if (!ctx || !view) return;
    running = true;
    const myGeneration = generation;
    const currentView = view;
    const currentCtx = ctx;
    const shouldClear = pendingClear;
    try {
      // A manually closed tab stays closed until the user explicitly invokes the shortcut.
      if (!focus && (!currentView.tab || !await currentView.owned())) { pendingClear = false; return; }
      // Zellij layout actions can activate their target tab even with --no-focus.
      if (!focus && !await currentView.visible()) return;
      // Validate the authoritative snapshot before any destructive pane actions.
      const children = activeChildren(await rpcStatus());
      if (myGeneration !== generation || currentView !== view) return;
      const sessionIds = [currentCtx.sessionManager.getSessionFile(), currentCtx.sessionManager.getSessionId()].filter((s): s is string => typeof s === 'string' && s.length > 0);
      const dirs = new Map<string, string>();
      for (const runId of new Set(children.map(child => child.rootId))) {
        const dir = await findRunDir(runId, sessionIds, hints.get(runId));
        if (!dir) throw new Error(`Run ${runId} has no verified current-session status artifact yet`);
        dirs.set(runId, dir);
      }
      if (myGeneration !== generation || currentView !== view) return;
      if (focus) {
        await currentView.open(); // Only an explicit shortcut/command may create a tab.
        if (myGeneration !== generation || currentView !== view) return;
        await currentView.focus(); // Explicit activation before any layout mutation.
      } else if (!await currentView.owned()) { pendingClear = false; return; }
      if (!await currentView.visible() || myGeneration !== generation) return;
      const reconciled = await currentView.reconcile(children, dirs);
      if (shouldClear && reconciled && myGeneration === generation) {
        if (await currentView.clearCompleted()) pendingClear = false;
      }
      lastWarning = '';
    } catch (error) {
      if (myGeneration === generation) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastWarning || Date.now() - lastWarningAt > 15000) {
          currentCtx.ui.notify(`Zellij subagents: ${message}`, 'warning');
          lastWarning = message;
          lastWarningAt = Date.now();
        }
      }
    } finally { running = false; }
  }
  function start(focus = false) {
    if (running) { again = true; pendingFocus ||= focus; return; }
    work = refresh(focus).finally(() => {
      work = undefined;
      if (again && ctx) { again = false; const shouldFocus = pendingFocus; pendingFocus = false; start(shouldFocus); }
    });
  }
  function schedule() {
    if (!ctx || !view?.tab || debounce) return;
    debounce = setTimeout(() => { debounce = undefined; start(); }, 100);
  }
  function activate(context: ExtensionContext) {
    if (context.mode !== 'tui' || !process.env.ZELLIJ) { context.ui.notify('Open this Pi session inside Zellij to use Alt+Z.', 'warning'); return; }
    if (!ctx) ctx = context;
    if (!view) view = new ZellijView({ viewer, name: `pi async ${randomUUID().slice(0, 8)}` });
    start(true);
  }
  pi.registerShortcut(Key.alt('z'), { description: 'Open/focus async subagent Zellij tab', handler: activate });
  pi.registerCommand('zellij-subagents', { description: 'Open/focus read-only async subagent panes in Zellij', handler: (_args, context) => activate(context) });
  pi.registerCommand('zellij-subagents-clear', { description: 'Clear completed panes in the owned Zellij tab', handler: () => {
    if (!ctx || !view?.tab) return;
    // Reconcile against a fresh authoritative snapshot before clearing; never close active panes.
    pendingClear = true;
    start();
  } });
  pi.on('session_start', (_event, context) => {
    if (context.mode !== 'tui' || !process.env.ZELLIJ) return;
    ctx = context;
    unsubs.push(
      pi.events.on('subagent:async-started', (data) => {
        const event = data as { id?: unknown; runId?: unknown; asyncDir?: unknown };
        const id = event?.runId ?? event?.id;
        if (typeof id === 'string' && typeof event.asyncDir === 'string') hints.set(id, event.asyncDir);
        schedule();
      }),
      pi.events.on('subagent:async-complete', schedule),
      pi.events.on('subagent:child-status', schedule),
      pi.events.on('subagents:rpc:v1:ready', schedule),
    );
    interval = setInterval(() => { if (view) schedule(); }, 2500);
  });
  pi.on('session_shutdown', async () => {
    generation++;
    ctx = undefined;
    if (interval) clearInterval(interval);
    if (debounce) clearTimeout(debounce);
    interval = undefined; debounce = undefined;
    for (const cancel of pending) cancel();
    for (const unsubscribe of unsubs.splice(0)) unsubscribe();
    hints.clear();
    const oldView = view;
    view = undefined;
    again = false;
    pendingFocus = false;
    pendingClear = false;
    await work;
    try { await oldView?.shutdown(); } catch { /* never close a tab if ownership verification fails */ }
  });
}
