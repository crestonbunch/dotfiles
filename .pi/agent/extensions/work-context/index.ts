import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  REQUEST_EVENT, SELECTION_ENTRY, SNAPSHOT_EVENT,
  parsePullRequestUrl, restoreSelection, updateSelection,
  type Selection, type SelectionUpdate, type WorkContextSnapshot, type WorkDirectory,
} from "./core.ts";
import { directoryQueries, discoverDirectory } from "./discovery.ts";

const DEBOUNCE_MS = 150;
const instruction = "Update work_context when switching directories, starting PR work, or finishing work. Piggyback tools.work_context({...}) into existing codemode scripts; supplied lists must be complete. Use known paths/URLs only; never investigate, retry, or ask permission. Execution cwd is unchanged.";
const forcedBlock = /(?:\n\n)?<!-- pi-work-context:start -->[\s\S]*?<!-- pi-work-context:end -->/g;

type State = {
  sessionId: string;
  interactive: boolean;
  selection: Selection;
  directories: WorkDirectory[];
  controller: AbortController;
  running: boolean;
  pending: boolean;
};

export default (pi: ExtensionAPI): void => {
  let state: State | undefined;
  let snapshot: WorkContextSnapshot | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const publish = (current: State): void => {
    if (state !== current) return;
    // PRs are pushed metadata only, never inferred from bookmarks or the network.
    const prs = (current.selection.prs ?? []).map(url => parsePullRequestUrl(url)!);
    snapshot = {
      version: 1,
      sessionId: current.sessionId,
      directories: current.directories.map(directory => ({ ...directory })),
      pullRequests: [...new Map(prs.map(pr => [pr.url, pr])).values()],
    };
    pi.events.emit(SNAPSHOT_EVENT, snapshot);
  };

  const stop = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    state?.controller.abort();
    state = undefined;
    snapshot = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
  };

  const refresh = async (current: State): Promise<void> => {
    if (state !== current) return;
    if (current.running) { current.pending = true; return; }
    current.running = true;
    try {
      const directories = await Promise.all(current.directories.map(directory =>
        discoverDirectory(directoryQueries(pi, directory.path, current.controller.signal), directory.path, directory)));
      if (state !== current) return;
      current.directories = directories;
      publish(current);
    } finally {
      current.running = false;
      if (state === current && current.pending) {
        current.pending = false;
        schedule(current);
      }
    }
  };

  const schedule = (current: State): void => {
    if (state !== current) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void refresh(current);
    }, DEBOUNCE_MS);
    timer.unref?.();
  };

  const select = (ctx: ExtensionContext, selection: Selection, preserve = false): void => {
    const previous = preserve ? state : undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
    state?.controller.abort();
    const paths = selection.directories ?? updateSelection({ version: 1 }, { directories: [ctx.cwd] }, ctx.cwd).directories!;
    const directories = paths.map(path => previous?.directories.find(directory => directory.path === path) ?? { path });
    state = {
      sessionId: ctx.sessionManager.getSessionId(), interactive: ctx.mode === "tui",
      selection, directories,
      controller: new AbortController(), running: false, pending: false,
    };
    publish(state);
  };

  const reconstruct = (_event: unknown, ctx: ExtensionContext): void => {
    let selection: Selection = { version: 1 };
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== SELECTION_ENTRY) continue;
      selection = restoreSelection(entry.data, ctx.cwd) ?? selection;
    }
    select(ctx, selection);
    unsubscribe?.();
    unsubscribe = pi.events.on(REQUEST_EVENT, data => {
      if (snapshot && data && typeof data === "object" && "sessionId" in data && data.sessionId === snapshot.sessionId) {
        pi.events.emit(SNAPSHOT_EVENT, snapshot);
      }
    });
    if (state!.interactive) schedule(state!);
  };

  pi.on("session_start", reconstruct);
  pi.on("session_tree", reconstruct);
  pi.on("session_shutdown", stop);
  const scheduleForContext = (_event: unknown, ctx: ExtensionContext): void => {
    if (state?.sessionId === ctx.sessionManager.getSessionId() && state.interactive) schedule(state);
  };
  pi.on("tool_execution_end", scheduleForContext);
  pi.on("agent_settled", scheduleForContext);

  pi.on("before_agent_start", event => {
    const options = event.systemPromptOptions;
    options.sections.work_context = instruction;
    if (typeof options.forceSystemPrompt === "string") {
      const base = options.forceSystemPrompt.replace(forcedBlock, "");
      options.forceSystemPrompt = `${base}${base ? "\n\n" : ""}<!-- pi-work-context:start -->\n${instruction}\n<!-- pi-work-context:end -->`;
    }
  });

  const applyUpdate = (ctx: ExtensionContext, params: SelectionUpdate) => {
    if (!state || state.sessionId !== ctx.sessionManager.getSessionId()) {
      return { content: [{ type: "text" as const, text: "Work-context update ignored because the session changed; execution cwd unchanged." }], details: undefined };
    }
    // Optional metadata must not interrupt substantive work in the same codemode script.
    try {
      const selection = updateSelection(state.selection, params, ctx.cwd);
      if (JSON.stringify(selection) !== JSON.stringify(state.selection)) {
        pi.appendEntry(SELECTION_ENTRY, selection);
        select(ctx, selection, true);
      }
      schedule(state!);
      return { content: [{ type: "text" as const, text: "Work-context display updated; execution cwd unchanged." }], details: undefined };
    } catch {
      return { content: [{ type: "text" as const, text: "Work-context update skipped: invalid metadata, full list, or persistence unavailable." }], details: undefined };
    }
  };

  pi.registerTool({
    name: "work_context",
    exposure: "codemode",
    label: "Work context",
    description: "Best-effort display metadata for known directories and GitHub PR URLs. Supplied arrays replace complete lists; omitted fields retain selection. prs: [] clears PRs; directories: [] restores session cwd fallback. No execution cwd effects or PR discovery.",
    // List limits are checked inside execute so overflow can be skipped without failing codemode.
    parameters: Type.Object({
      directories: Type.Optional(Type.Array(Type.String({ maxLength: 2048 }))),
      prs: Type.Optional(Type.Array(Type.String({ maxLength: 1024 }))),
    }),
    executionMode: "sequential",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    execute: async (_id, params, _signal, _onUpdate, ctx) => applyUpdate(ctx, params),
  });
};
